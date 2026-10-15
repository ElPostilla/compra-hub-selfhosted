// Express 4 no captura promesas rechazadas dentro de un route handler async:
// sin este wrapper, cualquier error de base de datos no manejado (timeout,
// constraint, lo que sea) tumba TODO el proceso Node -- no solo devuelve un
// 500 a esa peticion, se lleva por delante la API entera para todo el
// mundo (visto en produccion: un unico usuario con datos duplicados
// crasheaba el servicio para todos). Envuelve cada handler async con esto.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
