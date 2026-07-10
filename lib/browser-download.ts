export const downloadBlob = (blob: Blob, filename: string): void => {
  let objectUrl: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  try {
    objectUrl = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    if (objectUrl !== undefined) {
      const url = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
};
