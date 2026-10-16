declare module "*.md" {
  const text: string;
  export default text;
}

declare module "*.png" {
  const ruta: string;
  export default ruta;
}

declare module "*.svg" {
  const contenido: string;
  export default contenido;
}
