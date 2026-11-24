/* =====================================================================
   AuthService.js
   -----------------------------------------------------------------
   Responsável por tudo relacionado a "Gestão de Sessão":
     - Inicialização do Firebase (App, Auth, Firestore)
     - Login / logout / recuperação de senha
     - Proteção de rotas (requireAuth)

   Outros módulos (DashboardController, DevController) importam
   `auth` e `db` daqui em vez de inicializar o Firebase de novo.
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Dados reais copiados de Firebase Console → Configurações do projeto → App da Web "Vita web"
const firebaseConfig = {
  apiKey: "AIzaSyD2b4AR1rCStQ9pajWhcs7f2LXLngBXXdo",
  authDomain: "vita-sendemail.firebaseapp.com",
  projectId: "vita-sendemail",
  storageBucket: "vita-sendemail.firebasestorage.app",
  messagingSenderId: "1066710561089",
  appId: "1:1066710561089:web:b9cb480c9c5bf9dfc9b1c0",
  measurementId: "G-GLDQSKJXGR",
};

const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

/* ---------------------------------------------------------------------
   SESSÃO
   -----------------------------------------------------------------
   getCurrentUser() espera o Firebase confirmar (ou não) que existe um
   usuário logado antes de continuar — evita "piscar" a tela com erro
   no primeiro instante em que a página carrega.
--------------------------------------------------------------------- */
export function getCurrentUser() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}
// Protege páginas internas (dashboard, perfil): se não houver usuário
// logado, manda de volta para o login.
export async function requireAuth() {
    const user = await getCurrentUser();

    if (!user) {
        window.location.href = "login.html";
        return null;
    }

    try {
        if (await isDev(user.uid)) {
            window.location.href = "iniciodev.html";
            return null;
        }
    } catch (err) {
        console.error("Erro ao verificar perfil:", err);
        await signOut(auth);
        window.location.href = "login.html";
        return null;
    }

    return user;
}
/* ---------------------------------------------------------------------
   ACESSO DE DESENVOLVEDOR
   -----------------------------------------------------------------
   Um desenvolvedor é um usuário do Firebase Authentication que também
   tem um documento em `devs/{uid}` no Firestore. Quem concede o acesso
   é o Console (ou Admin SDK): as regras do Firestore impedem que o
   cliente crie ou altere documentos em `devs`.
--------------------------------------------------------------------- */
export async function isDev(uid) {
  const snap = await getDoc(doc(db, "devs", uid));
  return snap.exists();
}

// Protege o painel dev: exige sessão ativa E registro em `devs/{uid}`.
export async function requireDev() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "dev.html";
    return null;
  }

  let allowed = false;
  try {
    allowed = await isDev(user.uid);
  } catch (err) {
    console.error("Não foi possível verificar o acesso dev:", err);
  }

  if (!allowed) {
    window.location.href = "dev.html";
    return null;
  }
  return user;
}

// Login do desenvolvedor: autentica e confere `devs/{uid}`. Se a conta
// existe mas não é dev, a sessão recém-aberta é encerrada.
export async function loginDev(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);

  let allowed = false;
  try {
    allowed = await isDev(cred.user.uid);
  } finally {
    if (!allowed) await signOut(auth);
  }

  if (!allowed) {
    const err = new Error("Esta conta não tem acesso de desenvolvedor.");
    err.code = "vita/not-dev";
    throw err;
  }
  return cred.user;
}

/* ---------------------------------------------------------------------
   AÇÕES DE AUTENTICAÇÃO
--------------------------------------------------------------------- */
export function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}


/* =====================================================================
   PÁGINA: LOGIN DE USUÁRIO (login.html)
   ===================================================================== */
export function initUserLoginForm() {
  const form = document.getElementById("login-form");
  if (!form) return;

  const errorEl = document.getElementById("login-error");
  const submitBtn = form.querySelector("button");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.style.display = "none";

    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Entrando...";

    try {
      const credential = await loginWithEmail(email, password);

      // Conta dev não entra pelo login padrão.
      if (await isDev(credential.user.uid)) {
        await signOut(auth);
        throw Object.assign(
          new Error("Esta conta é de desenvolvedor. Utilize o acesso DEV."),
          { code: "vita/dev-account" }
        );
      }

      window.location.href = "iniciouser.html";
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err?.code === "vita/dev-account"
          ? err.message
          : "E-mail ou senha inválidos. Tente novamente.";
        errorEl.style.display = "block";
      }
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}

/* =====================================================================
   PÁGINA: ESQUECEU A SENHA (esqueceusenha.html)
   ===================================================================== */
export function initForgotPasswordForm() {
  const form = document.getElementById("forgot-form");
  if (!form) return;

  const errorEl = document.getElementById("forgot-error");
  const submitBtn = form.querySelector("button");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.style.display = "none";

    const email = document.getElementById("forgot-email").value;
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando...";

    try {
      await resetPassword(email);
    } catch (err) {
      // Não revela se o e-mail existe: só erros de rede/limite aparecem.
      if (err?.code === "auth/network-request-failed" || err?.code === "auth/too-many-requests") {
        if (errorEl) {
          errorEl.textContent = err.code === "auth/too-many-requests"
            ? "Muitas tentativas. Aguarde um pouco e tente novamente."
            : "Sem conexão. Verifique sua internet e tente novamente.";
          errorEl.style.display = "block";
        }
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
        return;
      }
      console.error("Erro ao enviar e-mail de redefinição:", err);
    }

    alert("Se existir uma conta com esse e-mail, você receberá um link para redefinir sua senha.");
    window.location.href = "login.html";
  });
}

/* =====================================================================
   PÁGINA: REDEFINIR SENHA (recuperarsenha.html)
   -----------------------------------------------------------------
   Só abre com o link enviado por e-mail (?mode=resetPassword&oobCode=...).
   Sem código válido, o usuário volta para o login.
   ===================================================================== */
export async function initResetPasswordPage() {
  const page = document.getElementById("reset-page");
  const form = document.getElementById("reset-form");
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const code = params.get("oobCode");

  const leave = (msg) => {
    if (msg) alert(msg);
    window.location.replace("login.html");
  };

  if (!code || (params.get("mode") && params.get("mode") !== "resetPassword")) {
    leave();
    return;
  }

  try {
    await verifyPasswordResetCode(auth, code);
  } catch (err) {
    leave("Este link de redefinição é inválido ou expirou. Solicite um novo.");
    return;
  }
  page.style.visibility = "visible";

  const errorEl = document.getElementById("reset-error");
  const submitBtn = form.querySelector("button[type='submit']");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.style.display = "none";
    submitBtn.disabled = true;

    try {
      await confirmPasswordReset(auth, code, document.getElementById("reset-password").value);
      alert("Senha redefinida com sucesso!");
      window.location.replace("login.html");
    } catch (err) {
      errorEl.textContent = err?.code === "auth/weak-password"
        ? "Senha muito fraca. Use pelo menos 6 caracteres."
        : "Não foi possível redefinir a senha. O link pode ter expirado.";
      errorEl.style.display = "block";
      submitBtn.disabled = false;
    }
  });
}

/* ---------------------------------------------------------------------
   LOGOUT GLOBAL
   -----------------------------------------------------------------
   Qualquer link/botão "Sair" da aplicação (data-view="sair") desloga
   do Firebase Auth antes de redirecionar.
--------------------------------------------------------------------- */
export function bindLogoutButtons() {
  document.querySelectorAll('[data-view="sair"]').forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      await logout();
      window.location.href = "index.html";
    });
  });
}
