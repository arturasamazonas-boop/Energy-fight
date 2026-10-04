import { t } from "../i18n.ts";

export const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let toastTimer: number | undefined;
export function toast(text: string, ms = 2600) {
  let el = document.querySelector(".toast") as HTMLElement | null;
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("show"), ms);
}

export function confirmDialog(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const d = document.createElement("div");
    d.className = "modal";
    d.innerHTML = `<div class="modal-box"><p>${esc(text)}</p><div class="row"><button class="ghost no">${t("cancel")}</button><button class="primary yes">${t("choose")}</button></div></div>`;
    document.body.appendChild(d);
    d.querySelector<HTMLButtonElement>(".no")!.onclick = () => {
      d.remove();
      resolve(false);
    };
    d.querySelector<HTMLButtonElement>(".yes")!.onclick = () => {
      d.remove();
      resolve(true);
    };
  });
}

export function modal(html: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "modal";
  d.innerHTML = `<div class="modal-box">${html}</div>`;
  document.body.appendChild(d);
  d.addEventListener("click", (e) => {
    if (e.target === d) d.remove();
  });
  return d;
}
