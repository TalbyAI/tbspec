const numericIdentifier = "(?:0|[1-9]\\d*)";
const prereleaseIdentifier = `(?:${numericIdentifier}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const versionPattern = new RegExp(
  `^(${numericIdentifier})\\.(${numericIdentifier})\\.(${numericIdentifier})(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

export function isValidReleaseVersion(value) {
  if (typeof value !== "string" || value.length > 256) return false;
  const match = versionPattern.exec(value);
  return (
    match?.[0] === value &&
    match.slice(1, 4).every((identifier) => Number.isSafeInteger(Number(identifier)))
  );
}

export function releaseBranchVersion(reference) {
  if (typeof reference !== "string") return null;
  const match = /^refs\/heads\/release\/(.+)$/.exec(reference);
  return match?.[0] === reference && isValidReleaseVersion(match[1]) ? match[1] : null;
}
