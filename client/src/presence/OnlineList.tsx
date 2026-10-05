import { useTranslation } from "react-i18next";
import { useAwareness, useStatus } from "../store/hooks";
import { initials } from "../canvas/style";
import { loadLocalUser, useRemoteParticipants } from "./presence";

/** Who is online in a shared plan: nickname and color of each participant. */
export function OnlineList() {
  const { t } = useTranslation();
  const awareness = useAwareness();
  const status = useStatus();
  const remotes = useRemoteParticipants(awareness);
  if (!awareness || status.connection === "none") return null;
  const me = loadLocalUser();
  return (
    <div className="online" data-testid="online-list" aria-label={t("presence.online")}>
      {me && (
        <span className="avatar me" style={{ background: me.color }} title={`${me.name} (${t("presence.you")})`}>
          {initials(me.name)}
        </span>
      )}
      {remotes.slice(0, 6).map((r) => (
        <span key={r.clientId} className="avatar" style={{ background: r.user.color }} title={r.user.name} data-testid="online-avatar">
          {initials(r.user.name)}
        </span>
      ))}
      {remotes.length > 6 && <span className="avatar more">+{remotes.length - 6}</span>}
    </div>
  );
}
