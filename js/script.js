/* =====================================================================
   script.js · Router
   -----------------------------------------------------------------
   Ponto de entrada único, carregado por TODAS as páginas HTML.
   Responsabilidade: olhar para o DOM da página atual, decidir "onde
   estamos" e chamar o controller certo. Nenhuma lógica de negócio
   mora aqui — ela vive em AuthService.js, DashboardController.js e
   DevController.js.
   ===================================================================== */

import { initUserLoginForm, initForgotPasswordForm, initResetPasswordPage, bindLogoutButtons } from "./AuthService.js";
import { initDashboard, initProfilePage } from "./DashboardController.js";
import { initDevLoginForm, initDevDashboard } from "./DevController.js";

// Olhinho de mostrar/ocultar senha: vale para qualquer .toggle-eye
// que esteja ao lado de um campo de senha (login, dev, recuperar senha).
function bindPasswordToggles() {
  document.querySelectorAll(".toggle-eye").forEach((eye) => {
    const input = eye.parentElement?.querySelector("input");
    if (!input) return;
    eye.setAttribute("role", "button");
    eye.setAttribute("aria-label", "Mostrar senha");
    eye.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      eye.textContent = show ? "🙈" : "👁️";
      eye.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindPasswordToggles();

  // Fluxo de autenticação
  if (document.getElementById("login-form")) {
    initUserLoginForm();
  }
  if (document.getElementById("forgot-form")) {
    initForgotPasswordForm();
  }

  if (document.getElementById("reset-form")) {
    initResetPasswordPage();
  }

  // Painel do usuário
  if (document.getElementById("stat-grid")) {
    initDashboard();
  }
  if (document.getElementById("profile-page")) {
    initProfilePage();
  }

  // Painel do desenvolvedor
  if (document.getElementById("dev-login-form")) {
    initDevLoginForm();
  }
  if (document.getElementById("dev-page")) {
    initDevDashboard();
  }

  // Disponível em qualquer página que tenha um botão/link "Sair"
  bindLogoutButtons();
});
