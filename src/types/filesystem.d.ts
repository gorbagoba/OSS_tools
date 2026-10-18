interface ShowFilePickerOptions {
  multiple?: boolean;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
  excludeAcceptAllOption?: boolean;
  startIn?: string;
  suggestedName?: string;
}

interface Window {
  showOpenFilePicker(options?: ShowFilePickerOptions): Promise<FileHandle[]>;
  showSaveFilePicker(options?: ShowFilePickerOptions): Promise<FileHandle | null>;
}

interface FileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}
