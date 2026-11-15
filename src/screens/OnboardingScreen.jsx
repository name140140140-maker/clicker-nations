import { useState, useEffect, useRef, useMemo } from "react";
import { Users, Map as MapIcon, Search, Shield, ArrowLeft, ChevronRight } from "lucide-react";
import TerritoryMap from "../TerritoryMap";
import { validateCountryName, NAME_MIN, NAME_MAX } from "../nations";
import { COUNTRY_MAP, DEAD_COUNTRIES, Flag, GameLogo, MapLegend, cnSfx, getTelegramDisplayName, t } from "../app/shared.jsx";



/* ------------------------------------------------------------------ */
/*  Onboarding                                                          */
/* ------------------------------------------------------------------ */

export function OnboardingScreen({ onFinish, lang = "uk", nations, onReloadNations, reassign = false, initialName = "" }) {
  const [username] = useState(initialName || getTelegramDisplayName());
  const [step, setStep] = useState("list"); // list (лише вибір реальної країни)
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(null); // країна, яка чекає підтвердження
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [region, setRegion] = useState(null); // { rid, name } — вибрана вільна область
  const [countryName, setCountryName] = useState("");
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);

  const countries = nations?.countries || [];
  const owners = nations?.owners || {};
  const hasName = username.trim().length > 0;

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  const flash = (text) => {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 3200);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const alive = countries.filter((c) => !DEAD_COUNTRIES.has(c.id)); // країни без міст вибули з гри
    if (!q) return alive;
    return alive.filter((c) => String(c.name).toLowerCase().includes(q) || String(c.nameEn || "").toLowerCase().includes(q) || c.id.toLowerCase() === q);
  }, [query, countries]);

  const goBack = () => {
    cnSfx.toggle();
    setStep("choice");
    setPending(null);
    setError("");
    setQuery("");
  };

  const joinCountry = async () => {
    if (!pending || submitting) return;
    setSubmitting(true);
    setError("");
    const res = await onFinish({ username, mode: "join", countryId: pending.id });
    if (!res.ok) {
      setError(res.reason || "Не вдалося приєднатися");
      setPending(null);
      setSubmitting(false);
    }
  };

  const handleSelectRegion = (r) => {
    if (r.ownerId) {
      const c = COUNTRY_MAP[r.ownerId];
      cnSfx.error();
      flash(t(lang, "nn_region_taken").replace("{name}", c?.name || "—"));
      return;
    }
    setError("");
    setRegion({ rid: r.rid, name: r.name });
  };

  const nameError = countryName.trim() ? validateCountryName(countryName, countries) : "";
  const canCreate = !!region && countryName.trim().length >= NAME_MIN && !nameError && !submitting;

  const createCountryNow = async () => {
    if (!canCreate) return;
    setSubmitting(true);
    setError("");
    const res = await onFinish({ username, mode: "create", name: countryName, regionId: region.rid });
    if (!res.ok) {
      setError(res.reason || "Не вдалося створити країну");
      setSubmitting(false);
      if (res.taken) {
        setRegion(null);
        onReloadNations();
      }
    }
  };

  /* ---------- Крок 1: вибір — існуюча країна чи власна ---------- */
  if (step === "choice") {
    return (
      <div className="cn-onboard">
        <div className="cn-onboard-header">
          <GameLogo size={56} className="cn-onboard-icon" />
          <div className="cn-onboard-title">WORLD CLICKER</div>
          <div className="cn-onboard-sub">{t(lang, "onboard_sub")}</div>
        </div>

        {reassign && <div className="cn-onboard-reassign">{t(lang, "nn_reassign_note")}</div>}

        <div className="cn-choice-list">
          <button type="button" className="cn-choice-btn" disabled={!hasName} onClick={() => { cnSfx.toggle(); setStep("list"); }}>
            <span className="cn-choice-icon"><Users size={26} /></span>
            <span className="cn-choice-text">
              <span className="cn-choice-title">{t(lang, "nn_play_existing")}</span>
              <span className="cn-choice-sub">{t(lang, "nn_play_existing_sub")} ({countries.length})</span>
            </span>
            <ChevronRight size={20} />
          </button>
        </div>
        {error && <div className="cn-onboard-blocked-msg">{error}</div>}

        <div className="cn-onboard-note">
          <Shield size={13} className="cn-onboard-note-icon" />
          {t(lang, "onboard_lock_note")}
        </div>
      </div>
    );
  }

  /* ---------- Крок 2а: список існуючих країн ---------- */
  if (step === "list") {
    return (
      <div className="cn-onboard">
        <div className="cn-onboard-header">
          <GameLogo size={48} className="cn-onboard-icon" />
          <div className="cn-onboard-title">{t(lang, "nn_list_title")}</div>
          <div className="cn-onboard-sub">{t(lang, "onboard_sub")}</div>
        </div>
        {reassign && <div className="cn-onboard-reassign">{t(lang, "nn_reassign_note")}</div>}

        <div className="cn-country-search-wrap cn-country-search-wrap--static">
          <Search size={15} className="cn-country-search-icon" />
          <input
            className="cn-country-search"
            placeholder={t(lang, "onboard_country_search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {error && <div className="cn-onboard-blocked-msg">{error}</div>}

        <div className="cn-nation-list">
          {countries.length === 0 && (
            <div className="cn-nation-empty">
              {t(lang, "nn_list_empty")}
            </div>
          )}
          {countries.length > 0 && filtered.length === 0 && (
            <div className="cn-nation-empty">{t(lang, "onboard_country_empty")}</div>
          )}
          {filtered.map((c) => (
            <button key={c.id} type="button" className="cn-nation-row" onClick={() => { cnSfx.toggle(); setPending(c); }}>
              <Flag code={c.id} size={30} className="cn-country-badge--lg" />
              <span className="cn-nation-name">{c.name}</span>
              <span className="cn-nation-meta">{c.regionCount || 0} {t(lang, "nn_regions_count")}</span>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>

        {pending && (
          <div className="cn-modal-overlay cn-modal-overlay--center" onClick={() => !submitting && setPending(null)}>
            <div className="cn-confirm-modal" onClick={(e) => e.stopPropagation()}>
              <Flag code={pending.id} size={52} className="cn-country-badge--lg" />
              <div className="cn-confirm-title">{t(lang, "nn_confirm_title")}</div>
              <div className="cn-confirm-text">{t(lang, "nn_confirm_text").replace("{name}", pending.name)}</div>
              <div className="cn-confirm-actions">
                <button type="button" className="cn-dev-btn" disabled={submitting} onClick={() => setPending(null)}>
                  {t(lang, "nn_confirm_no")}
                </button>
                <button type="button" className="cn-dev-btn cn-dev-btn--primary" disabled={submitting} onClick={joinCountry}>
                  {submitting ? t(lang, "onboard_creating_btn") : t(lang, "nn_confirm_yes")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ---------- Крок 2б: створення своєї країни — вибір вільної області ---------- */
  return (
    <div className="cn-onboard cn-onboard--map">
      <div className="cn-step-bar">
        <button type="button" className="cn-back-btn" onClick={goBack} aria-label={t(lang, "nn_back")}>
          <ArrowLeft size={20} />
        </button>
        <div className="cn-step-title">{t(lang, "nn_create_title")}</div>
      </div>
      <div className="cn-create-panel">
        <label className="cn-label">{t(lang, "nn_country_name_label")}</label>
        <input
          className="cn-input"
          maxLength={NAME_MAX}
          placeholder={t(lang, "nn_country_name_ph")}
          value={countryName}
          onChange={(e) => setCountryName(e.target.value)}
        />
        {(nameError || error) && <div className="cn-onboard-blocked-msg">{nameError || error}</div>}
      </div>

      <div className="cn-create-region" style={{ marginTop: 12, marginBottom: 10 }}>
        <MapIcon size={15} />
        {region ? (
          <span>{t(lang, "nn_region_selected")}: <b>{region.name}</b></span>
        ) : (
          <span className="cn-create-region-empty">{t(lang, "nn_create_hint")}</span>
        )}
      </div>

      <div className="cn-tmap-viewport">
        <TerritoryMap mode="pick" owners={owners} countries={countries} selectedRid={region?.rid} onSelectRegion={handleSelectRegion} />
        {toast && <div className="cn-tmap-toast">{toast}</div>}
      </div>

      <MapLegend lang={lang} />

      <button className="cn-primary-btn" disabled={!canCreate} onClick={createCountryNow} style={{ marginTop: 4 }}>
        <span className="cn-primary-btn-emoji">🏁</span>
        <span className="cn-primary-btn-label">{submitting ? t(lang, "onboard_creating_btn") : t(lang, "nn_confirm_btn")}</span>
        <ChevronRight size={20} className="cn-primary-btn-chevron" />
      </button>
    </div>
  );
}
