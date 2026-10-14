import { createContext, useContext } from "react";

/** Sube cada vez que cambian los datos (desde esta pantalla o desde una IA). */
export const VersionCtx = createContext(0);
export const useVersion = () => useContext(VersionCtx);
