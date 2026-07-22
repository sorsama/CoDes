import { providerMeta } from "../lib/providers";

export function ProviderIcon({ provider, compact = false }: { provider: string; compact?: boolean }) {
  const meta = providerMeta(provider);
  return (
    <span className={`provider-icon${compact ? " provider-icon--compact" : ""}`}>
      <img src={meta.iconPath} alt="" aria-hidden="true" />
    </span>
  );
}
