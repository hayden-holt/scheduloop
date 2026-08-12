import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  addDaysToDateKey,
  getWeekStartDateKey,
  normalizeBreakMinutes,
  normalizeEmployeeForm,
  ROTA_STATUS,
} from "../utils/rota";

function requireBusinessId(businessId) {
  if (!businessId) {
    throw new Error("You must be logged in to manage rota data.");
  }
}

function profileCollection(businessId, name) {
  requireBusinessId(businessId);
  return collection(db, "businessProfiles", businessId, name);
}

function profileDoc(businessId, collectionName, id) {
  requireBusinessId(businessId);
  return doc(db, "businessProfiles", businessId, collectionName, id);
}

function mapEmployeeDoc(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    displayName: data.displayName || "",
    defaultRole: data.defaultRole || "",
    hourlyRate:
      data.hourlyRate === null || data.hourlyRate === undefined
        ? null
        : Number(data.hourlyRate),
    active: data.active !== false,
    ownerUid: data.ownerUid || "",
    businessId: data.businessId || "",
  };
}

function mapShiftDoc(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    employeeId: data.employeeId || "",
    date: data.date || "",
    startTime: data.startTime || "",
    endTime: data.endTime || "",
    roleId: data.roleId || "",
    breakMinutes: normalizeBreakMinutes(data.breakMinutes),
    weekStart: data.weekStart || getWeekStartDateKey(data.date),
    ownerUid: data.ownerUid || "",
    businessId: data.businessId || "",
  };
}

export async function loadEmployees(businessId) {
  const snapshot = await getDocs(profileCollection(businessId, "employees"));
  return snapshot.docs
    .map(mapEmployeeDoc)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function saveEmployee(businessId, employee) {
  requireBusinessId(businessId);
  const normalized = normalizeEmployeeForm(employee);
  const payload = {
    ...normalized,
    businessId,
    updatedAt: serverTimestamp(),
  };

  if (employee.id) {
    await setDoc(profileDoc(businessId, "employees", employee.id), payload, {
      merge: true,
    });
    return { ...employee, ...normalized, businessId };
  }

  const ref = await addDoc(profileCollection(businessId, "employees"), {
    ...payload,
    createdAt: serverTimestamp(),
  });

  return { id: ref.id, ...normalized, businessId };
}

export async function deactivateEmployee(businessId, employeeId) {
  requireBusinessId(businessId);
  await setDoc(
    profileDoc(businessId, "employees", employeeId),
    {
      active: false,
      businessId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function loadWeekShifts(businessId, weekStartKey) {
  const weekEndKey = addDaysToDateKey(weekStartKey, 7);
  const snapshot = await getDocs(
    query(
      profileCollection(businessId, "shifts"),
      where("date", ">=", weekStartKey),
      where("date", "<", weekEndKey)
    )
  );

  return snapshot.docs
    .map(mapShiftDoc)
    .sort((a, b) =>
      `${a.date}-${a.startTime}-${a.employeeId}`.localeCompare(
        `${b.date}-${b.startTime}-${b.employeeId}`
      )
    );
}

export async function saveShift(businessId, shift) {
  requireBusinessId(businessId);
  const weekStart = shift.weekStart || getWeekStartDateKey(shift.date);
  const payload = {
    employeeId: shift.employeeId,
    date: shift.date,
    startTime: shift.startTime,
    endTime: shift.endTime,
    roleId: shift.roleId,
    breakMinutes: normalizeBreakMinutes(shift.breakMinutes),
    weekStart,
    businessId,
    updatedAt: serverTimestamp(),
  };

  if (shift.id) {
    await setDoc(profileDoc(businessId, "shifts", shift.id), payload, {
      merge: true,
    });
    return { ...shift, ...payload };
  }

  const ref = await addDoc(profileCollection(businessId, "shifts"), {
    ...payload,
    createdAt: serverTimestamp(),
  });

  return { id: ref.id, ...payload };
}

export async function deleteShift(businessId, shiftId) {
  requireBusinessId(businessId);
  await deleteDoc(profileDoc(businessId, "shifts", shiftId));
}

export async function loadRotaWeek(businessId, weekStartKey) {
  const snapshot = await getDoc(profileDoc(businessId, "rotaWeeks", weekStartKey));
  if (!snapshot.exists()) {
    return {
      weekStart: weekStartKey,
      status: ROTA_STATUS.draft,
    };
  }

  const data = snapshot.data();
  return {
    weekStart: weekStartKey,
    status:
      data.status === ROTA_STATUS.published
        ? ROTA_STATUS.published
        : ROTA_STATUS.draft,
    ownerUid: data.ownerUid || "",
    businessId: data.businessId || "",
  };
}

export async function saveRotaWeekStatus(businessId, weekStartKey, status) {
  requireBusinessId(businessId);
  const safeStatus =
    status === ROTA_STATUS.published ? ROTA_STATUS.published : ROTA_STATUS.draft;
  const payload = {
    weekStart: weekStartKey,
    status: safeStatus,
    businessId,
    updatedAt: serverTimestamp(),
  };

  if (safeStatus === ROTA_STATUS.published) {
    payload.publishedAt = serverTimestamp();
  }

  await setDoc(profileDoc(businessId, "rotaWeeks", weekStartKey), payload, {
    merge: true,
  });

  return payload;
}

export async function createCopiedWeekShifts(businessId, shifts) {
  requireBusinessId(businessId);
  const batch = writeBatch(db);
  const refs = [];

  shifts.forEach((shift) => {
    const ref = doc(profileCollection(businessId, "shifts"));
    refs.push(ref);
    batch.set(ref, {
      employeeId: shift.employeeId,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      roleId: shift.roleId,
      breakMinutes: normalizeBreakMinutes(shift.breakMinutes),
      weekStart: shift.weekStart,
      businessId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();

  return shifts.map((shift, index) => ({
    id: refs[index].id,
    ...shift,
    businessId,
  }));
}

export async function copyWeekShiftsAsDraft(businessId, weekStartKey, shifts) {
  requireBusinessId(businessId);
  const batch = writeBatch(db);
  const refs = [];

  shifts.forEach((shift) => {
    const ref = doc(profileCollection(businessId, "shifts"));
    refs.push(ref);
    batch.set(ref, {
      employeeId: shift.employeeId,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      roleId: shift.roleId,
      breakMinutes: normalizeBreakMinutes(shift.breakMinutes),
      weekStart: shift.weekStart || weekStartKey,
      businessId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  batch.set(
    profileDoc(businessId, "rotaWeeks", weekStartKey),
    {
      weekStart: weekStartKey,
      status: ROTA_STATUS.draft,
      businessId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();

  return shifts.map((shift, index) => ({
    id: refs[index].id,
    ...shift,
    weekStart: shift.weekStart || weekStartKey,
    businessId,
  }));
}

export async function replaceWeekShiftsAsDraft(businessId, weekStartKey, shifts) {
  requireBusinessId(businessId);
  const weekEndKey = addDaysToDateKey(weekStartKey, 7);
  const currentSnapshot = await getDocs(
    query(
      profileCollection(businessId, "shifts"),
      where("date", ">=", weekStartKey),
      where("date", "<", weekEndKey)
    )
  );
  const batch = writeBatch(db);
  const refs = [];

  currentSnapshot.docs.forEach((snapshot) => {
    batch.delete(profileDoc(businessId, "shifts", snapshot.id));
  });

  shifts.forEach((shift) => {
    const ref = doc(profileCollection(businessId, "shifts"));
    refs.push(ref);
    batch.set(ref, {
      employeeId: shift.employeeId,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      roleId: shift.roleId,
      breakMinutes: normalizeBreakMinutes(shift.breakMinutes),
      weekStart: shift.weekStart || weekStartKey,
      businessId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  batch.set(
    profileDoc(businessId, "rotaWeeks", weekStartKey),
    {
      weekStart: weekStartKey,
      status: ROTA_STATUS.draft,
      businessId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();

  return {
    deletedCount: currentSnapshot.docs.length,
    shifts: shifts.map((shift, index) => ({
      id: refs[index].id,
      ...shift,
      weekStart: shift.weekStart || weekStartKey,
      businessId,
    })),
  };
}
