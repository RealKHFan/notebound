// The Notebound mark: a pocket notebook held shut by an elastic band.
export function Logo({ size = 40, plain = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" class="logo">
      {plain ? null : <rect width="48" height="48" rx="13" fill="#2E4BD6" />}
      <rect x="16.5" y="11.5" width="19" height="27" rx="3.5" fill="#B9C6F5" />
      <rect x="13.5" y="9.5" width="20" height="28" rx="3.5" fill="#FFFFFF" />
      <rect x="13.5" y="9.5" width="3.2" height="28" rx="1.4" fill="#DDE4FB" />
      <rect x="27.6" y="8" width="3.6" height="31" rx="1.6" fill="#F0A92E" />
    </svg>
  );
}
