export class NexusError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'NexusError';
    this.status = status;
  }
}
