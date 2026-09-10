// Firebase-konfiguration för den delade lobbyn.
//
// Fyll i värdena från Firebase-konsolen (Project settings → General → "Your apps"
// → SDK setup and configuration). Webb-config är INTE hemlig — den skickas ändå
// till varje besökares webbläsare. Det som skyddar datan är firestore.rules och
// (valfritt) App Check, inte att gömma de här nycklarna.
//
// Så länge fälten står kvar som "" är lobbyläget helt avstängt och appen kör
// enbart lokalt mot localStorage.

export const firebaseConfig = {
  apiKey: "AIzaSyDCglc6iQiH4FALMaIaA554azkxA7dytmU",
  authDomain: "destiny2-curses.firebaseapp.com",
  projectId: "destiny2-curses",
  storageBucket: "destiny2-curses.firebasestorage.app",
  messagingSenderId: "199510023677",
  appId: "1:199510023677:web:4e6f8dfa7d385560ec4d94"
};

// Valfritt: reCAPTCHA v3-nyckel för Firebase App Check. Lämna tom för att hoppa
// över App Check (helt ok på Spark-planen — ingen ekonomisk risk).
export const recaptchaV3SiteKey = "";
