import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getAnalytics, isSupported } from "firebase/analytics";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCkpBj6DOG1019SwBhYLeo7Mru20eAD_pU",
  authDomain: "app-egn-c-asaas.firebaseapp.com",
  projectId: "app-egn-c-asaas",
  storageBucket: "app-egn-c-asaas.firebasestorage.app",
  messagingSenderId: "33138466890",
  appId: "1:33138466890:web:5f9c614132a532911f46b3",
  measurementId: "G-L9SM2EX4SK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

export let analytics: any = null;
if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      try {
        analytics = getAnalytics(app);
      } catch (e) {
        console.warn("Analytics not initialized:", e);
      }
    }
  }).catch(() => {});
}

