import { Store, detectarStorage } from "./db/store";
import { App } from "./ui/app";

async function boot() {
  const root = document.getElementById("app")!;
  const status = document.getElementById("boot")!;
  try {
    // En el EXE las funciones del host se inyectan antes de cargar la página.
    const storage = detectarStorage();
    const store = await Store.open(storage);
    status.remove();
    (window as any).__pc05 = { store, app: new App(store, root) };
    window.addEventListener("beforeunload", () => {
      if (store.dirty) store.saveNow();
    });
  } catch (e: any) {
    status.innerHTML = `<div class="alert err" style="margin:24px"><b>No se pudo iniciar la aplicación.</b><br>${String(e && e.message ? e.message : e)}<br><br>No se modificó ningún dato. Copia este mensaje y la versión del navegador.</div>`;
    console.error(e);
  }
}
boot();
