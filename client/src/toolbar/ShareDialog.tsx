import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../app/Dialog";
import { toast, ui } from "../app/uiStore";
import { roomLink, SyncError } from "../lib/sync";
import { loadLocalUser, saveLocalUser, setPresence } from "../presence/presence";
import { useSession, useStatus } from "../store/hooks";

const PRIVACY_KEY = "seatplan.privacyAccepted";

function privacyAccepted(): boolean {
  try {
    return localStorage.getItem(PRIVACY_KEY) === "1";
  } catch {
    return false;
  }
}

function CopyField({ label, value, testId }: { label: string; value: string; testId: string }) {
  const { t } = useTranslation();
  return (
    <label className="field copy-field">
      <span>{label}</span>
      <div className="copy-row">
        <input readOnly value={value} onFocus={(e) => e.target.select()} data-testid={testId} />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              toast(t("share.copied"));
            } catch {
              toast(t("share.copyFailed"), "warn");
            }
          }}
        >
          {t("share.copy")}
        </button>
      </div>
    </label>
  );
}

export function ShareDialog() {
  const { t } = useTranslation();
  const session = useSession();
  const status = useStatus();
  const [nickname, setNickname] = useState(loadLocalUser()?.name ?? "");
  const [acceptedBefore] = useState(privacyAccepted);
  const [accepted, setAccepted] = useState(acceptedBefore);
  const [busy, setBusy] = useState(false);
  const close = () => ui.set({ dialog: null });
  const isRoom = session.target.kind === "room";
  const isViewer = session.target.kind === "room" && session.target.role === "view";
  const share = status.share;

  const saveNickname = () => {
    if (!nickname.trim()) return;
    const user = saveLocalUser(nickname);
    setPresence(session.awareness, { user });
  };

  const start = async () => {
    if (!nickname.trim()) return;
    saveNickname();
    try {
      localStorage.setItem(PRIVACY_KEY, "1");
    } catch {
      // ignore
    }
    setBusy(true);
    try {
      await session.startSharing();
    } catch (err) {
      toast(err instanceof SyncError && err.message === "rate_limited" ? t("share.rateLimited") : t("share.unreachable"), "error", 8000);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!confirm(t("share.confirmStop"))) return;
    setBusy(true);
    try {
      await session.stopSharing();
      toast(t("share.stopped"));
    } catch {
      toast(t("share.unreachable"), "error");
    } finally {
      setBusy(false);
    }
  };

  // Not shared yet: privacy notice, nickname, create links.
  if (!share && !isRoom) {
    return (
      <Dialog title={t("share.title")} onClose={close}>
        <p>{t("share.intro")}</p>
        <div className="privacy" data-testid="privacy-notice">
          <h3>{t("share.privacyTitle")}</h3>
          <ul>
            <li>{t("share.privacy1")}</li>
            <li>{t("share.privacy2")}</li>
            <li>{t("share.privacy3")}</li>
            <li>{t("share.privacy4")}</li>
          </ul>
          {!acceptedBefore && (
            <label className="checkbox">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="privacy-accept" />
              {t("share.privacyAccept")}
            </label>
          )}
        </div>
        <label className="field">
          <span>{t("share.nickname")}</span>
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={t("share.nicknamePlaceholder")} data-testid="nickname" maxLength={40} />
        </label>
        <div className="dialog-actions">
          <span className="spacer" />
          <button onClick={close}>{t("common.cancel")}</button>
          <button className="primary" onClick={start} disabled={busy || !accepted || !nickname.trim()} data-testid="create-share">
            {busy ? t("share.creating") : t("share.create")}
          </button>
        </div>
      </Dialog>
    );
  }

  const roomId = share?.roomId ?? (session.target.kind === "room" ? session.target.roomId : "");
  return (
    <Dialog title={t("share.title")} onClose={close}>
      <p className="connection-line">
        <span className={`status-dot ${status.connection}`} /> {t(`share.status.${status.roomGone ? "gone" : status.connection}`)}
      </p>
      {isViewer ? (
        <p>{t("share.viewerInfo")}</p>
      ) : (
        <>
          {share?.editToken && (
            <CopyField label={t("share.editLink")} value={roomLink(roomId, "edit", share.editToken)} testId="edit-link" />
          )}
          {share?.viewToken ? (
            <CopyField label={t("share.viewLink")} value={roomLink(roomId, "view", share.viewToken)} testId="view-link" />
          ) : (
            <p className="hint">{t("share.viewLinkLoading")}</p>
          )}
          <p className="hint">{t("share.linkHint")}</p>
        </>
      )}
      <label className="field">
        <span>{t("share.nickname")}</span>
        <div className="copy-row">
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={40} />
          <button onClick={saveNickname} disabled={!nickname.trim()}>
            {t("common.save")}
          </button>
        </div>
      </label>
      <p className="hint">{t("share.expiry")}</p>
      <div className="dialog-actions">
        {isRoom && (
          <a className="button" href="#/">
            {t("share.backToMine")}
          </a>
        )}
        <span className="spacer" />
        {share?.editToken && !status.roomGone && (
          <button className="danger" onClick={stop} disabled={busy} data-testid="stop-share">
            {t("share.stop")}
          </button>
        )}
        <button className="primary" onClick={close}>
          {t("common.done")}
        </button>
      </div>
    </Dialog>
  );
}
