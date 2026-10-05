import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../app/Dialog";
import { toast, ui } from "../app/uiStore";
import { importGuests } from "../store/actions";
import { useSession } from "../store/hooks";
import { parseGuestList } from "./parseGuestList";

export function ImportDialog() {
  const { t } = useTranslation();
  const session = useSession();
  const [text, setText] = useState("");
  const rows = useMemo(() => parseGuestList(text), [text]);
  const close = () => ui.set({ dialog: null });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
  };

  const run = () => {
    const { added, groupsCreated } = importGuests(session.doc, rows);
    toast(t("import.done", { count: added, groups: groupsCreated }));
    close();
  };

  return (
    <Dialog title={t("import.title")} onClose={close} wide>
      <p className="hint">{t("import.help")}</p>
      <pre className="example">{t("import.example")}</pre>
      <textarea
        autoFocus
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("import.placeholder")}
        data-testid="import-text"
      />
      <label className="file-input">
        {t("import.file")}
        <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {rows.length > 0 && (
        <div className="preview">
          <strong>{t("import.preview", { count: rows.length })}</strong>
          <table>
            <thead>
              <tr>
                <th>{t("guest.name")}</th>
                <th>{t("guest.group")}</th>
                <th>{t("guest.childShort")}</th>
                <th>{t("guest.note")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{r.group ?? ""}</td>
                  <td>{r.isChild ? "✓" : ""}</td>
                  <td>{r.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 8 && <p className="hint">{t("import.more", { count: rows.length - 8 })}</p>}
        </div>
      )}
      <div className="dialog-actions">
        <span className="spacer" />
        <button onClick={close}>{t("common.cancel")}</button>
        <button className="primary" onClick={run} disabled={rows.length === 0} data-testid="import-run">
          {t("import.run", { count: rows.length })}
        </button>
      </div>
    </Dialog>
  );
}
