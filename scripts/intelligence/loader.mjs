// Lets plain `node --experimental-strip-types` run the engines: the app's
// source uses extensionless imports (as Next resolves them), which Node
// does not. This hook retries a failed relative import with ".ts".
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
    throw err;
  }
}
