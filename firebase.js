// UrbaLens — Firebase Configuration
// Replace with your own Firebase project credentials

const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase (uncomment when credentials are set)
// import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
// import { getFirestore, collection, addDoc, getDocs, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
// import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js";

// const app = initializeApp(FIREBASE_CONFIG);
// const db = getFirestore(app);
// const storage = getStorage(app);

// ─── Firestore Data Layer ───────────────────────────────────────────────────

const FirestoreService = {

  async addReport(reportData) {
    // const docRef = await addDoc(collection(db, "reports"), {
    //   ...reportData,
    //   timestamp: serverTimestamp()
    // });
    // return docRef.id;

    // Local fallback (remove when Firebase is connected)
    const id = `local_${Date.now()}`;
    const stored = JSON.parse(localStorage.getItem("urbalens_reports") || "[]");
    stored.push({ id, ...reportData, timestamp: new Date().toISOString() });
    localStorage.setItem("urbalens_reports", JSON.stringify(stored));
    return id;
  },

  async getReports() {
    // const q = query(collection(db, "reports"), orderBy("timestamp", "desc"));
    // const snapshot = await getDocs(q);
    // return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Local fallback
    return JSON.parse(localStorage.getItem("urbalens_reports") || "[]");
  },

  subscribeToReports(callback) {
    // const q = query(collection(db, "reports"), orderBy("timestamp", "desc"));
    // return onSnapshot(q, (snapshot) => {
    //   const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    //   callback(reports);
    // });

    // Local fallback: poll every 5 seconds
    const poll = () => {
      const reports = JSON.parse(localStorage.getItem("urbalens_reports") || "[]");
      callback(reports);
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }
};

// ─── Storage Layer ──────────────────────────────────────────────────────────

const StorageService = {
  async uploadImage(file, reportId) {
    // const storageRef = ref(storage, `reports/${reportId}/${file.name}`);
    // await uploadBytes(storageRef, file);
    // return await getDownloadURL(storageRef);

    // Local fallback: convert to base64
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
};

export { FirestoreService, StorageService, FIREBASE_CONFIG };
