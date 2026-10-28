/** Error de aplicación con código estable (la interfaz lo recibe en el sobre IPC) y mensaje en español. */
export class AppError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
