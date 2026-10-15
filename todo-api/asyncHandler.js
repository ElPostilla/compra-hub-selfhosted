// Express 4 no captura promesas rechazadas dentro de un route handler async:
// sin este wrapper, cualquier error no manejado tumbaria el proceso Node
// entero (visto en produccion en otras APIs del hub). Envuelve cada handler
// async con esto.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
