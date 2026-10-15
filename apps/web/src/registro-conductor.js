export function prepararRegistroConductor(formulario) {
  const datos = Object.fromEntries(new FormData(formulario));
  if (datos.password !== datos.confirmarPassword) {
    throw new Error("Las contraseñas no coinciden.");
  }
  return {
    nombre: String(datos.nombre ?? "").trim(),
    usuario: String(datos.usuario ?? "").trim(),
    correo: String(datos.correo ?? "").trim(),
    password: datos.password,
    confirmarPassword: datos.confirmarPassword,
  };
}
