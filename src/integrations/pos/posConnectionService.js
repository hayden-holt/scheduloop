import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";

export function subscribeToPosConnection({
  businessId,
  provider,
  onNext,
  onError,
}) {
  if (!businessId || !provider) {
    onNext(null);
    return () => {};
  }

  return onSnapshot(
    doc(db, "businessProfiles", businessId, "posConnections", provider),
    (snapshot) => {
      onNext(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    },
    onError
  );
}
