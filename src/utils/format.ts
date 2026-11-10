export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.ceil(seconds)}d`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins}m ${secs}d`;
}

export function isTextPreviewable(mimeType: string, fileName: string): boolean {
  if (mimeType.startsWith('text/')) return true;
  if (
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript'
  ) {
    return true;
  }
  return /\.(txt|md|json|csv|xml|html|css|js|ts|tsx|py|yaml|yml|log|env)$/i.test(fileName);
}

export function isImagePreviewable(mimeType: string, fileName: string): boolean {
  if (mimeType.startsWith('image/') && !mimeType.includes('svg')) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(fileName);
}
