import { useState } from "react";
import type { Despliegue } from "./api.ts";
import { Icon } from "./components.tsx";

/** Apoyo voluntario a Kromo (enlace normal: el widget de Ko-fi carga scripts de terceros y la CSP lo bloquea). */
export const KOFI_URL = "https://ko-fi.com/aurora33";
/** Contacto para pedir la versión en la nube. Cambiar por la página del servicio cuando esté publicada. */
export const NUBE_URL = "mailto:hola@aurora33.app?subject=Kromo%20Cargo%20en%20la%20nube";

/** En instalaciones que administra Aurora33 para un cliente no se pide apoyo ni se promociona nada. */
export const mostrarApoyo = (d: Despliegue) => d !== "gestionado";
/** La promoción de la nube solo tiene sentido si los datos viven en la computadora de la persona. */
export const datosLocales = (d: Despliegue) => d === "local" || d === "docker";

const CLAVE = "kromo-aviso-nube";
const DIA = 24 * 60 * 60 * 1000;

function leer(): number | null {
  try {
    const v = localStorage.getItem(CLAVE);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function posponer(dias: number) {
  try {
    localStorage.setItem(CLAVE, String(Date.now() + dias * DIA));
  } catch {}
}

/**
 * Aviso discreto (a lo más una vez por semana) de que los datos viven en esta computadora. La primera
 * vez solo se programa para dentro de 2 días: no aparece en el primer uso. Nunca roba el foco.
 */
export function AvisoNube({ despliegue }: { despliegue: Despliegue }) {
  const [visible, setVisible] = useState(() => {
    if (!datosLocales(despliegue)) return false;
    const hasta = leer();
    if (hasta === null) return posponer(2), false;
    return Date.now() >= hasta;
  });
  if (!visible) return null;
  const cerrar = (dias: number) => (posponer(dias), setVisible(false));
  return (
    <aside className="aviso-nube" aria-label="Respaldo en la nube">
      <Icon name="cloud" />
      <p>
        <b>Tus datos viven solo en esta computadora.</b> Si se descompone, se pierden. Te instalamos Kromo Cargo en la nube con respaldos automáticos y acceso desde el celular.
      </p>
      <div className="aviso-acciones">
        <a className="btn sm" href={NUBE_URL} onClick={() => cerrar(7)}>
          Quiero la nube
        </a>
        <button type="button" className="btn sm ghost" onClick={() => cerrar(30)}>
          No mostrar en 30 días
        </button>
        <button type="button" className="btn ghost icon sm" aria-label="Cerrar aviso" title="Cerrar" onClick={() => cerrar(7)}>
          <Icon name="x" />
        </button>
      </div>
    </aside>
  );
}

/** Tarjeta fija (Ajustes → Negocio) para quien tiene los datos en su computadora. */
export function TarjetaNube({ despliegue }: { despliegue: Despliegue }) {
  if (!datosLocales(despliegue)) return null;
  return (
    <section className="card nube" aria-labelledby="nube-titulo">
      <div className="card-head">
        <span className="ico"><Icon name="cloud" /></span>
        <h2 id="nube-titulo">¿Tus datos en la nube?</h2>
      </div>
      <p>
        Hoy todo se guarda {despliegue === "docker" ? "en el Docker de" : "en"} esta computadora. Te la instalamos en la nube, a tu nombre, con respaldos automáticos, tu dominio y acceso
        desde el celular, Claude y ChatGPT.
      </p>
      <div className="row">
        <a className="btn primary" href={NUBE_URL}>
          Quiero la versión en la nube
        </a>
      </div>
    </section>
  );
}
