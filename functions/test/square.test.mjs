import assert from 'node:assert/strict';
import { test, beforeEach, mock } from 'node:test';
import { createSquareLifecycle } from '../src/pos/lifecycle.js';
import { createOAuthStateRecord } from '../src/pos/oauthState.js';
import { encryptSecret, decryptSecret } from '../src/pos/crypto.js';
import { sanitizeBusinessId } from '../src/pos/authz.js';
import { getSquarePaymentIdFromWebhook, createSquareWebhookSignature } from '../src/pos/webhooks.js';
import { collectSquarePayments, revokeSquareAccessToken, refreshSquareAccessToken } from '../src/pos/squareClient.js';
import { getSquareLocalTimestamp } from '../src/pos/timezone.js';

// An optimistic transaction double: retries conflicts, stages writes atomically,
// and rejects reads after writes. No test can access production Firestore.
class MemoryFirestore {
  rows = new Map();
  versions = new Map();
  failWrite = null;
  doc(path) {
    const db = this;
    return { path, get: async () => db.snapshot(path),
      set: async (data, options) => db.put(path, data, options),
      delete: async () => db.put(path, null),
    };
  }
  snapshot(path) {
    const value = structuredClone(this.rows.get(path));
    return { exists: value !== undefined, data: () => value };
  }
  put(path, data, options) {
    if (this.failWrite?.(path, data)) throw new Error('simulated storage outage');
    if (data === null) this.rows.delete(path);
    else this.rows.set(path, this.merge(options?.merge ? this.rows.get(path) || {} : {}, data));
    this.versions.set(path, (this.versions.get(path) || 0) + 1);
  }
  merge(old, update) {
    const result = structuredClone(old);
    for (const [key, value] of Object.entries(update)) {
      if (value?.__increment !== undefined) result[key] = (result[key] || 0) + value.__increment;
      else if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
        result[key] = this.merge(result[key] || {}, value);
      } else result[key] = structuredClone(value);
    }
    return result;
  }
  async runTransaction(fn) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const reads = new Map(); const writes = [];
      const tx = {
        get: async ref => { assert.equal(writes.length, 0, 'Firestore requires reads before writes');
          reads.set(ref.path, this.versions.get(ref.path) || 0); return this.snapshot(ref.path); },
        set: (ref, data, options) => writes.push([ref.path, data, options]),
        delete: ref => writes.push([ref.path, null]),
      };
      const result = await fn(tx);
      if ([...reads].some(([p,v]) => (this.versions.get(p) || 0) !== v)) continue;
      for (const [p,d] of writes) if (this.failWrite?.(p,d)) throw new Error('simulated storage outage');
      writes.forEach(args => this.put(...args));
      return result;
    }
    throw new Error('transaction contention');
  }
  collection(path) {
    let predicate = () => true; let cap = Infinity;
    const query = {
      where: (key, op, value) => { assert.equal(op,'=='); predicate = row => row[key] === value; return query; },
      limit: value => { cap = value; return query; },
      get: async () => {
        const docs = [...this.rows].filter(([p,v]) => p.startsWith(path+'/') && p.split('/').length === path.split('/').length+1 && predicate(v))
          .slice(0,cap).map(([p]) => this.snapshot(p));
        return { docs, size: docs.length };
      },
    };
    return query;
  }
}

const db = new MemoryFirestore();
let clock;
let lifecycle;
const key = Buffer.alloc(32, 7).toString('base64'); // Synthetic test-only key.
const config = { environment: 'production', tokenEncryptionKey: key, applicationId: 'test-app', applicationSecret: 'test-secret' };
const conn = id => `businessProfiles/${id}/posConnections/square`;
const secrets = id => `posSecrets/${id}_square`;
const mapping = id => `posMerchantMappings/square_${id}`;
const token = (merchant='merchant-a') => ({ merchant_id: merchant, access_token: 'test-access', refresh_token: 'test-refresh', expires_at: new Date(Date.now()+30*86400_000).toISOString() });
const location = { squareLocationId: 'loc-a', scheduleLoopLocationId: 'default', timezone: 'Europe/London' };
function seedBusiness(biz='biz-a', uid='user-a') {
  db.put(`memberships/${uid}`, { businessId: biz, role: 'owner', status: 'active', onboardingComplete: true });
  db.put(`businessProfiles/${biz}`, { ownerUid: uid, hours: { open: '09:00', close: '17:00' }, operatingRules: { intervalMinutes: 30 } });
}
async function connect(biz='biz-a', uid='user-a', merchant='merchant-a') {
  return lifecycle.withLease(biz, lease => lifecycle.saveConnection(lease, { uid, token: token(merchant), locations: [location], config }));
}
function deferred() { let resolve; const promise = new Promise(r=>{ resolve=r; }); return {promise,resolve}; }

beforeEach(() => {
  db.rows.clear(); db.versions.clear(); db.failWrite=null;
  clock=Date.now(); lifecycle=createSquareLifecycle({ db, stamp:()=>new Date(clock), now:()=>clock });
  seedBusiness();
});

test('OAuth state consumption is atomic under concurrent callbacks', async () => {
  const { record } = createOAuthStateRecord({ uid:'user-a', businessId:'biz-a' });
  const ref=db.doc('squareOAuthStates/test'); await ref.set(record);
  const results=await Promise.allSettled([lifecycle.consumeState(ref),lifecycle.consumeState(ref)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.ok((await ref.get()).data().consumedAt);
  await assert.rejects(lifecycle.consumeState(ref));
});
test('OAuth rejects expired state and revoked or cross-business membership', async () => {
  for (const change of ['expired','inactive','other-business','employee']) {
    seedBusiness();
    const { record }=createOAuthStateRecord({uid:'user-a',businessId:'biz-a'});
    if(change==='expired') record.expiresAt=new Date(clock-1).toISOString();
    if(change==='inactive') db.put('memberships/user-a',{status:'inactive'},{merge:true});
    if(change==='other-business') db.put('memberships/user-a',{businessId:'biz-b'},{merge:true});
    if(change==='employee') db.put('memberships/user-a',{role:'employee'},{merge:true});
    const ref=db.doc('squareOAuthStates/test'); await ref.set(record);
    await assert.rejects(lifecycle.consumeState(ref));
    assert.equal((await ref.get()).data().consumedAt,null);
  }
});
test('OAuth rechecks membership again after token exchange before saving credentials', async () => {
  const {record}=createOAuthStateRecord({uid:'user-a',businessId:'biz-a'});
  const ref=db.doc('squareOAuthStates/test'); await ref.set(record); await lifecycle.consumeState(ref);
  db.put('memberships/user-a',{status:'inactive'},{merge:true});
  await assert.rejects(connect());
  assert.equal(db.rows.has(secrets('biz-a')),false);
  assert.equal(db.rows.has(mapping('merchant-a')),false);
});
test('two businesses cannot claim the same Square merchant concurrently', async () => {
  seedBusiness('biz-b','user-b');
  const result=await Promise.allSettled([connect(),connect('biz-b','user-b')]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  const owner=db.rows.get(mapping('merchant-a')).businessId;
  assert.equal(db.rows.has(secrets(owner)),true);
  assert.equal(db.rows.has(secrets(owner==='biz-a'?'biz-b':'biz-a')),false);
});
test('reconnect retires old merchant routing and keeps encrypted tokens private', async () => {
  await connect();
  await assert.rejects(connect('biz-a','user-a','merchant-new'), {code:'disconnect-required'});
  await lifecycle.withLease('biz-a', lease => lifecycle.disconnect(lease, {uid:'user-a',config,revoke:async()=>({success:true})}));
  await connect('biz-a','user-a','merchant-new');
  assert.equal(db.rows.get(mapping('merchant-a')).connectionStatus,'disconnected');
  assert.equal(db.rows.get(mapping('merchant-new')).connectionStatus,'connected');
  assert.equal(db.rows.get(secrets('biz-a')).externalMerchantId,'merchant-new');
  assert.equal(JSON.stringify(db.rows.get(conn('biz-a'))).includes('test-access'),false);
  assert.equal(JSON.stringify(db.rows.get(mapping('merchant-new'))).includes('test-refresh'),false);
  assert.equal(decryptSecret(db.rows.get(secrets('biz-a')).encryptedAccessToken,key),'test-access');
});
test('a failed atomic connection save cannot leave partial credentials or mappings', async () => {
  db.failWrite=p=>p===mapping('merchant-a');
  await assert.rejects(connect());
  assert.equal(db.rows.has(secrets('biz-a')),false);
  assert.equal(db.rows.has(mapping('merchant-a')),false);
});
test('fresh tokens are reused and expired tokens are refreshed and encrypted', async () => {
  await connect(); let calls=0;
  const refresh=async args=>{ calls++; assert.equal(args.refreshToken,'test-refresh'); return {...token(),access_token:'new-access',refresh_token:'new-refresh'}; };
  await lifecycle.withLease('biz-a',async lease=> {
    assert.equal((await lifecycle.getSecret(lease,config,refresh)).accessToken,'test-access');
    assert.equal(calls,0);
    db.put(secrets('biz-a'),{accessTokenExpiresAt:new Date(clock-1).toISOString()},{merge:true});
    assert.equal((await lifecycle.getSecret(lease,config,refresh)).accessToken,'new-access');
  });
  assert.equal(calls,1);
  assert.equal(decryptSecret(db.rows.get(secrets('biz-a')).encryptedRefreshToken,key),'new-refresh');
  assert.equal(JSON.stringify(db.rows.get(secrets('biz-a'))).includes('new-access'),false);
});
test('refresh failure is recoverable and never returns expired tokens', async () => {
  await connect(); const prior=db.rows.get(secrets('biz-a')).encryptedRefreshToken;
  db.put(secrets('biz-a'),{accessTokenExpiresAt:''},{merge:true});
  await assert.rejects(lifecycle.withLease('biz-a',lease=>lifecycle.getSecret(lease,config,async()=>{throw new Error('provider response with secret');})),error=>!error.message.includes('secret'));
  assert.equal(db.rows.get(secrets('biz-a')).encryptedRefreshToken,prior);
  assert.equal(db.rows.get(conn('biz-a')).connectionStatus,'problem');
  await lifecycle.withLease('biz-a',lease=>lifecycle.getSecret(lease,config,async()=>token()));
});
test('credential reads reject environment, merchant and business mismatches', async () => {
  for(const mutation of [{environment:'sandbox'},{businessId:'biz-b'},{externalMerchantId:'merchant-b'}]) {
    await connect(); db.put(secrets('biz-a'),mutation,{merge:true});
    await assert.rejects(lifecycle.withLease('biz-a',lease=>lifecycle.getSecret(lease,config,async()=>token())));
  }
});
test('concurrent refresh operations are serialized and late writes are fenced', async () => {
  await connect(); db.put(secrets('biz-a'),{accessTokenExpiresAt:''},{merge:true});
  const started=deferred(), resume=deferred();
  const operation=lifecycle.withLease('biz-a',lease=>lifecycle.getSecret(lease,config,async()=>{started.resolve(); await resume.promise; return token();}));
  await started.promise;
  await assert.rejects(lifecycle.withLease('biz-a',()=>assert.fail('must not execute')));
  clock+=601_000;
  await lifecycle.withLease('biz-a',async lease=>{
    resume.resolve(); await assert.rejects(operation);
    await lifecycle.guarded(lease,async()=>{});
  });
});
test('webhook failure retries; completed duplicates do not process twice', async () => {
  await connect(); let calls=0;
  const run=()=>lifecycle.withLease('biz-a',lease=>lifecycle.processEvent(lease,{
    merchantId:'merchant-a',eventId:'event-a',eventType:'payment.updated',process:async()=>{ if(++calls===1) throw new Error('temporary outage'); },
  }));
  await assert.rejects(run());
  assert.equal(db.rows.has('posWebhookEvents/square_event-a'),false);
  assert.deepEqual(await run(),{duplicate:false});
  assert.deepEqual(await run(),{duplicate:true});
  assert.equal(calls,2);
});
test('old incomplete webhook markers retry and cross-business event markers reject', async () => {
  await connect(); let calls=0;
  db.put('posWebhookEvents/square_event-a',{businessId:'biz-a',merchantId:'merchant-a',createdAt:new Date()});
  const run=()=>lifecycle.withLease('biz-a',lease=>lifecycle.processEvent(lease,{merchantId:'merchant-a',eventId:'event-a',eventType:'payment.updated',process:async()=>{calls++;}}));
  await run(); assert.equal(calls,1);
  db.put('posWebhookEvents/square_event-a',{businessId:'biz-b'},{merge:true}); await assert.rejects(run());
});
test('disconnect revokes remotely, removes credentials, retires mapping and preserves history', async () => {
  await connect(); db.put('businessProfiles/biz-a/posTransactions/square_pay-a',{revenue:10}); let calls=0;
  await lifecycle.withLease('biz-a',lease=>lifecycle.disconnect(lease,{uid:'user-a',config,revoke:async args=>{calls++; assert.equal(args.accessToken,'test-access');}}));
  assert.equal(calls,1); assert.equal(db.rows.has(secrets('biz-a')),false);
  assert.equal(db.rows.get(mapping('merchant-a')).connectionStatus,'disconnected');
  assert.equal(db.rows.get(conn('biz-a')).connectionStatus,'disconnected');
  assert.equal(db.rows.get('businessProfiles/biz-a/posTransactions/square_pay-a').revenue,10);
  seedBusiness('biz-b','user-b'); await assert.rejects(connect('biz-b','user-b'));
});
test('failed revocation blocks ingestion and reconnect until disconnect retry succeeds', async () => {
  await connect();
  await assert.rejects(lifecycle.withLease('biz-a',lease=>lifecycle.disconnect(lease,{uid:'user-a',config,revoke:async()=>{throw new Error('outage');}})));
  assert.equal(db.rows.get(secrets('biz-a')).revocationPending,true);
  await assert.rejects(connect());
  await assert.rejects(lifecycle.withLease('biz-a',lease=>lifecycle.getSecret(lease,config,async()=>token())));
  await lifecycle.withLease('biz-a',lease=>lifecycle.disconnect(lease,{uid:'user-a',config,revoke:async()=>{}}));
  assert.equal(db.rows.has(secrets('biz-a')),false);
});
test('cross-business disconnect cannot touch another business credentials',async()=>{
  await connect(); seedBusiness('biz-b','user-b');
  await assert.rejects(lifecycle.withLease('biz-a',lease=>lifecycle.disconnect(lease,{uid:'user-b',config,revoke:async()=>assert.fail()})));
  assert.equal(db.rows.get(mapping('merchant-a')).connectionStatus,'connected');
});
test('refunds use payment_id, never the refund ID; unrelated event types are ignored',()=>{
  for(const type of ['refund.created','refund.updated']) {
    assert.equal(getSquarePaymentIdFromWebhook({type,data:{id:'refund-id',object:{refund:{id:'refund-id',payment_id:'payment-id'}}}}),'payment-id');
    assert.equal(getSquarePaymentIdFromWebhook({type,data:{id:'refund-id'}}),'');
  }
  assert.equal(getSquarePaymentIdFromWebhook({type:'payment.updated',data:{object:{payment:{id:'payment-id'}}}}),'payment-id');
  assert.equal(getSquarePaymentIdFromWebhook({type:'order.updated',data:{id:'order-id'}}),'');
});
test('Square input timezone handles British summer/winter time without forecast changes',()=>{
  assert.equal(getSquareLocalTimestamp('2026-07-02T08:15:00Z','Europe/London'),'2026-07-02T09:15:00');
  assert.equal(getSquareLocalTimestamp('2026-01-02T09:15:00Z','Europe/London'),'2026-01-02T09:15:00');
  assert.equal(getSquareLocalTimestamp('2026-07-02T23:15:00Z','Europe/London'),'2026-07-03T00:15:00');
});
test('IDs reject path traversal and encryption rejects weak keys and tampering',()=>{
  for(const id of ['', '../x', 'x/y','x\\y','a\n','a'.repeat(129),'.','..']) assert.throws(()=>sanitizeBusinessId(id));
  assert.equal(sanitizeBusinessId('biz-a'),'biz-a');
  assert.throws(()=>encryptSecret('test','weak'));
  const encrypted=encryptSecret('test',key); assert.equal(decryptSecret(encrypted,key),'test');
  assert.throws(()=>decryptSecret(encrypted,Buffer.alloc(32,8).toString('base64')));
});
test('pagination reports truncation correctly and clears cursor when complete',async()=>{
  let pages=0;
  const result=await collectSquarePayments({fetchPage:async()=>++pages===1?{payments:[],cursor:'next'}:{payments:[]}});
  assert.equal(result.truncated,false); assert.equal(result.nextCursor,'');
  assert.equal((await collectSquarePayments({maxPages:1,fetchPage:async()=>({payments:[],cursor:'next'})})).truncated,true);
});
test('Square revoke uses Client authorization; refresh uses the refresh grant',async t=>{
  const calls=[]; t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,...options});return {ok:true,json:async()=>({success:true,...token()})};});
  await revokeSquareAccessToken({accessToken:'test-access',clientId:'test-app',clientSecret:'test-secret',environment:'production'});
  assert.equal(calls[0].headers.Authorization,'Client test-secret');
  assert.equal(JSON.parse(calls[0].body).client_secret,undefined);
  await refreshSquareAccessToken({refreshToken:'test-refresh',clientId:'test-app',clientSecret:'test-secret',environment:'production'});
  assert.equal(JSON.parse(calls[1].body).grant_type,'refresh_token');
});

// Exercise the actual exported handlers with only provider I/O replaced.
mock.module('firebase-admin/app',{namedExports:{initializeApp:()=>({})}});
mock.module('firebase-admin/firestore',{namedExports:{getFirestore:()=>db,
  FieldValue:{serverTimestamp:()=>new Date(),increment:n=>({__increment:n})},
  Timestamp:{fromDate:date=>date},
}});
mock.module('firebase-functions/params',{namedExports:{defineSecret:name=>({name})}});
mock.module('firebase-functions/v2/https',{namedExports:{
  onCall:(options,handler)=>Object.assign(handler,{options}),onRequest:(options,handler)=>Object.assign(handler,{options}),
  HttpsError:class extends Error {constructor(code,message){super(message);this.code=code;}},
}});
Object.assign(process.env,{ ENABLE_SQUARE_INTEGRATION:'true', SQUARE_ENVIRONMENT:'production',
  APP_BASE_URL:'https://app.scheduleloop.co.uk', SQUARE_APPLICATION_ID:'test-app', SQUARE_APPLICATION_SECRET:'test-secret',
  SQUARE_TOKEN_ENCRYPTION_KEY:key, SQUARE_WEBHOOK_SIGNATURE_KEY:'test-signature',
  SQUARE_REDIRECT_URI:'https://us-central1-scheduloop-96f9a.cloudfunctions.net/squareOAuthCallback',
  SQUARE_WEBHOOK_NOTIFICATION_URL:'https://us-central1-scheduloop-96f9a.cloudfunctions.net/squareWebhook',
});
const handlers=await import('../src/index.js');
function response(){return {headers:{},statusCode:200,set(k,v){this.headers[k]=v;return this;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},redirect(v){this.redirectUrl=v;return this;},end(){return this;}};}
function webhookRequest(type='payment.updated',eventId='event-a'){
  const event={type,event_id:eventId,merchant_id:'merchant-a',data:{id:'pay-a',object:{payment:{id:'pay-a'}}}};
  const rawBody=Buffer.from(JSON.stringify(event));
  return {method:'POST',rawBody,body:event,get:()=>createSquareWebhookSignature({rawBody,notificationUrl:process.env.SQUARE_WEBHOOK_NOTIFICATION_URL,signatureKey:'test-signature'})};
}
const payment=()=>({id:'pay-a',location_id:'loc-a',status:'COMPLETED',created_at:'2026-07-02T08:15:00Z',updated_at:'2026-07-02T08:16:00Z',amount_money:{amount:1000,currency:'GBP'}});
test('all five exported Functions bind secrets; only webhook binds signature key',()=>{
  assert.equal(Object.keys(handlers).length,5);
  for(const [name,handler] of Object.entries(handlers)){
    assert.ok(handler.options.secrets.some(s=>s.name==='SQUARE_APPLICATION_SECRET'));
    assert.ok(handler.options.secrets.some(s=>s.name==='SQUARE_TOKEN_ENCRYPTION_KEY'));
    assert.equal(handler.options.secrets.some(s=>s.name==='SQUARE_WEBHOOK_SIGNATURE_KEY'),name==='squareWebhook');
    assert.equal(handler.options.region,'us-central1');
  }
});
test('callback handler consumes state, exchanges code, encrypts credentials and redirects to production',async t=>{
  t.mock.method(globalThis,'fetch',async url=>({ok:true,json:async()=>String(url).endsWith('/oauth2/token')?token():{locations:[{id:'loc-a',timezone:'Europe/London'}]}}));
  const {url}=await handlers.createSquareOAuthUrl({auth:{uid:'user-a'},data:{businessId:'biz-a'}});
  const state=new URL(url).searchParams.get('state'); const res=response();
  await handlers.squareOAuthCallback({method:'GET',query:{state,code:'test-code'}},res);
  assert.equal(res.redirectUrl,'https://app.scheduleloop.co.uk/data-sources?square=connected');
  assert.ok(db.rows.get(secrets('biz-a')).encryptedRefreshToken);
  assert.equal(res.headers['Referrer-Policy'],'no-referrer');
  const replay=response();await handlers.squareOAuthCallback({method:'GET',query:{state,code:'test-code'}},replay);
  assert.match(replay.redirectUrl,/square=error$/);
});
test('webhook handler rejects invalid signatures and wrong methods without provider calls',async t=>{
  t.mock.method(globalThis,'fetch',async()=>assert.fail('must not call Square'));
  const req=webhookRequest();req.get=()=> 'invalid';let res=response();await handlers.squareWebhook(req,res);assert.equal(res.statusCode,403);
  res=response();await handlers.squareWebhook({method:'GET'},res);assert.equal(res.statusCode,405);
});
test('webhook handler recovers after model write failure without counting payment twice',async t=>{
  await connect();t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({payment:payment()})}));
  let fail=true;db.failWrite=(p,d)=>p==='businessProfiles/biz-a' && d?.posDemand && fail;
  const req=webhookRequest();const first=response();await handlers.squareWebhook(req,first);
  assert.equal(first.statusCode,503);
  const txPath='businessProfiles/biz-a/posTransactions/square_pay-a';assert.equal(db.rows.get(txPath).transactionCount,1);
  assert.equal(db.rows.has('posWebhookEvents/square_event-a'),false);
  fail=false;const second=response();await handlers.squareWebhook(req,second);assert.equal(second.statusCode,200);
  const bucket=db.rows.get('businessProfiles/biz-a/demandBuckets/square_2026-07-02_09:00');assert.equal(bucket.transactionCount,1);
  assert.equal(db.rows.get('businessProfiles/biz-a').posDemand.rows,1);
  const third=response();await handlers.squareWebhook(req,third);assert.equal(third.body.duplicate,true);
});
test('out-of-order updates cannot roll back newer transaction data',async t=>{
  await connect();let current={...payment(),updated_at:'2026-07-02T09:00:00Z',refunded_money:{amount:500,currency:'GBP'}};
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({payment:current})}));
  await handlers.squareWebhook(webhookRequest('payment.updated','event-new'),response());
  current=payment();await handlers.squareWebhook(webhookRequest('payment.updated','event-old'),response());
  assert.equal(db.rows.get('businessProfiles/biz-a/posTransactions/square_pay-a').revenue,5);
});
