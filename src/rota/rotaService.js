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

function requireUserId(userId) {
  if (!userId) {
    throw new Error("You must be logged in to manage rota data.");
  }
}

function profileCollection(userId, name) {
  requireUserId(userId);
  return collection(db, "businessProfiles", userId, name);
}

function profileDoc(userId, collectionName, id) {
  requireUserId(userId);
  return doc(db, "businessProfiles", userId, collectionName, id);
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
  };
}

export async function loadEmployees(userId) {
  const snapshot = await getDocs(profileCollection(userId, "employees"));
  return snapshot.docs
    .map(mapEmployeeDoc)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function saveEmployee(userId, employee) {
  requireUserId(userId);
  const normalized = normalizeEmployeeForm(employee);
  const payload = {
    ...normalized,
    ownerUid: userId,
    updatedAt: serverTimestamp(),
  };

  if (employee.id) {
    await setDoc(profileDoc(userId, "employees", employee.id), payload, {
      merge: true,
    });
    return { ...employee, ...normalized, ownerUid: userId };
  }

  const ref = await addDoc(profileCollection(userId, "employees"), {
    ...payload,
    createdAt: serverTimestamp(),
  });

  return { id: ref.id, ...normalized, ownerUid: userId };
}

export async function deactivateEmployee(userId, employeeId) {
  requireUserId(userId);
  await setDoc(
    profileDoc(userId, "employees", employeeId),
    {
      active: false,
      ownerUid: userId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function loadWeekShifts(userId, weekStartKey) {
  const weekEndKey = addDaysToDateKey(weekStartKey, 7);
  const snapshot = await getDocs(
    query(
      profileCollection(userId, "shifts"),
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

export async function saveShift(userId, shift) {
  requireUserId(userId);
  const weekStart = shift.weekStart || getWeekStartDateKey(shift.date);
  const payload = {
    employeeId: shift.employeeId,
    date: shift.date,
    startTime: shift.startTime,
    endTime: shift.endTime,
    roleId: shift.roleId,
    breakMinutes: normalizeBreakMinutes(shift.breakMinutes),
    weekStart,
    ownerUid: userId,
    updatedAt: serverTimestamp(),
  };

  if (shift.id) {
    await setDoc(profileDoc(userId, "shifts", shift.id), payload, {
      merge: true,
    });
    return { ...shift, ...payload };
  }

  const ref = await addDoc(profileCollection(userId, "shifts"), {
    ...payload,
    createdAt: serverTimestamp(),
  });

  return { id: ref.id, ...payload };
}

export async function deleteShift(userId, shiftId) {
  requireUserId(userId);
  await deleteDoc(profileDoc(userId, "shifts", shiftId));
}

export async function loadRotaWeek(userId, weekStartKey) {
  const snapshot = await getDoc(profileDoc(userId, "rotaWeeks", weekStartKey));
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
  };
}

export async function saveRotaWeekStatus(userId, weekStartKey, status) {
  requireUserId(userId);
  const safeStatus =
    status === ROTA_STATUS.published ? ROTA_STATUS.published : ROTA_STATUS.draft;
  const payload = {
    weekStart: weekStartKey,
    status: safeStatus,
    ownerUid: userId,
    updatedAt: serverTimestamp(),
  };

  if (safeStatus === ROTA_STATUS.published) {
    payload.publishedAt = serverTimestamp();
  }

  await setDoc(profileDoc(userId, "rotaWeeks", weekStartKey), payload, {
    merge: true,
  });

  return payload;
}

export async function createCopiedWeekShifts(userId, shifts) {
  requireUserId(userId);
  const batch = writeBatch(db);
  const refs = [];

  shifts.forEach((shift) => {
    const ref = doc(profileCollection(userId, "shifts"));
    refs.push(ref);
    batch.set(ref, {
      employeeId: shift.employeeId,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      roleId: shift.roleId,
      breakMinutes: normalizeBreakMinutes(shift.breakMinutes),
      weekStart: shift.weekStart,
      ownerUid: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();

  return shifts.map((shift, index) => ({
    id: refs[index].id,
    ...shift,
    ownerUid: userId,
  }));
}

export async function copyWeekShiftsAsDraft(userId, weekStartKey, shifts) {
  requireUserId(userId);
  const batch = writeBatch(db);
  const refs = [];

  shifts.forEach((shift) => {
    const ref = doc(profileCollection(userId, "shifts"));
    refs.push(ref);
    batch.set(ref, {
      employeeId: shift.employeeId,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      roleId: shift.roleId,
      breakMinutes: normalizeBreakMinutes(shift.breakMinutes),
      weekStart: shift.weekStart || weekStartKey,
      ownerUid: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  batch.set(
    profileDoc(userId, "rotaWeeks", weekStartKey),
    {
      weekStart: weekStartKey,
      status: ROTA_STATUS.draft,
      ownerUid: userId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();

  return shifts.map((shift, index) => ({
    id: refs[index].id,
    ...shift,
    weekStart: shift.weekStart || weekStartKey,
    ownerUid: userId,
  }));
}

export async function replaceWeekShiftsAsDraft(userId, weekStartKey, shifts) {
  requireUserId(userId);
  const weekEndKey = addDaysToDateKey(weekStartKey, 7);
  const currentSnapshot = await getDocs(
    query(
      profileCollection(userId, "shifts"),
      where("date", ">=", weekStartKey),
      where("date", "<", weekEndKey)
    )
  );
  const batch = writeBatch(db);
  const refs = [];

  currentSnapshot.docs.forEach((snapshot) => {
    batch.delete(profileDoc(userId, "shifts", snapshot.id));
  });

  shifts.forEach((shift) => {
    const ref = doc(profileCollection(userId, "shifts"));
    refs.push(ref);
    batch.set(ref, {
      employeeId: shift.employeeId,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      roleId: shift.roleId,
      breakMinutes: normalizeBreakMinutes(shift.breakMinutes),
      weekStart: shift.weekStart || weekStartKey,
      ownerUid: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  batch.set(
    profileDoc(userId, "rotaWeeks", weekStartKey),
    {
      weekStart: weekStartKey,
      status: ROTA_STATUS.draft,
      ownerUid: userId,
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
      ownerUid: userId,
    })),
  };
}
