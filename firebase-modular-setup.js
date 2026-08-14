  import { initializeApp as initializeAppModular } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import {
    getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    doc, setDoc, getDoc, getDocFromServer, getDocs, deleteDoc, updateDoc, addDoc,
    collection, query, where, orderBy, limit,
    writeBatch, runTransaction, increment, serverTimestamp, deleteField,
    onSnapshot, Timestamp
  } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
  import {
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, signInAnonymously,
    setPersistence, browserLocalPersistence, updatePassword, RecaptchaVerifier, signInWithPhoneNumber
  } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
  import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
  import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";
  import { getMessaging, getToken as getMessagingToken, onMessage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
  import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

  // Nada de esto se EJECUTA todavía contra la app real — solo se guardan las
  // funciones. getApp() recién se llama más adelante, dentro de
  // iniciarFirebase(), después de que Compat ya haya inicializado la app
  // (si se llamara acá arriba, todavía no existiría ninguna app que obtener).
  window.__fbModular = {
    initializeAppModular,
    firestore: { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, getDocFromServer, getDocs, deleteDoc, updateDoc, addDoc, collection, query, where, orderBy, limit, writeBatch, runTransaction, increment, serverTimestamp, deleteField, onSnapshot, Timestamp },
    auth: { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, signInAnonymously, setPersistence, browserLocalPersistence, updatePassword, RecaptchaVerifier, signInWithPhoneNumber },
    storage: { getStorage, ref, uploadBytes, getDownloadURL, deleteObject },
    appCheck: { initializeAppCheck, ReCaptchaV3Provider, getAppCheckToken },
    messaging: { getMessaging, getMessagingToken, onMessage },
    functions: { getFunctions, httpsCallable }
  };
  console.log('[SDK modular] Funciones cargadas y listas — todavía dormidas, sin usarse.');
