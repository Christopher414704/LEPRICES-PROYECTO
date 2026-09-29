export function notFoundHandler(req, res) {
  res.status(404).json({
    status: "error",
    message: "La ruta solicitada no existe.",
    method: req.method,
    path: req.originalUrl,
  });
}