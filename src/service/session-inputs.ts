/** Pure exact-image encoding shared by legacy and isolated visual session seams. */
export function exactImageInput(bytes: Buffer, format: string) {
  if (!["png", "jpeg", "webp"].includes(format))
    throw Error("Unsupported session image format");
  return {
    type: "image" as const,
    url: "data:image/" + format + ";base64," + bytes.toString("base64"),
  };
}
