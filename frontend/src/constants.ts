export const OUTPUT_FORMATS: Record<string, { value: string; label: string }[]> = {
  video: [
    { value: 'mp4', label: 'MP4' },
    { value: 'mkv', label: 'MKV' },
    { value: 'webm', label: 'WebM' },
    { value: 'avi', label: 'AVI' },
    { value: 'flv', label: 'FLV' },
  ],
  audio: [
    { value: 'mp3', label: 'MP3' },
    { value: 'm4a', label: 'M4A' },
    { value: 'aac', label: 'AAC' },
    { value: 'ogg', label: 'OGG' },
    { value: 'wav', label: 'WAV' },
    { value: 'flac', label: 'FLAC' },
    { value: 'opus', label: 'Opus' },
  ],
  image: [
    { value: 'png', label: 'PNG' },
    { value: 'jpg', label: 'JPG' },
    { value: 'webp', label: 'WebP' },
  ],
}

export const DEFAULT_OUTPUT_FORMAT: Record<string, string> = {
  video: 'mp4',
  audio: 'mp3',
  image: 'png',
}
