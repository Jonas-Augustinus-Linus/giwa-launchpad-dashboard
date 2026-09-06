const CATALOG_URL = "./data/catalog.json";
const PROBE_COMMAND = "PYTHONPATH=src python3 -m giwa_lab.probe";
const CHECK_COMMANDS = [
  "PYTHONPATH=src python3 -m unittest discover -s tests -v",
  "python3 -m compileall -q src",
  "python3 -m json.tool data/ecosystem.json >/dev/null",
  "python3 scripts/build_dashboard_catalog.py --check",
].join("\n");

const state = {
  catalog: null,
  filter: "all",
  query: "",
  lastFocused: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const normalizeSafeUrl = (value = "") => {
  const raw = String(value).trim();
  const localPath = raw.split(/[?#]/, 1)[0];
  if (
    /^\.\/library\/[A-Za-z0-9._/-]+\.html(?:#[A-Za-z0-9._:-]+)?$/.test(raw)
    && !localPath.split("/").includes("..")
  ) {
    return raw;
  }
  try {
    const parsed = new URL(raw);
    if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
      return parsed.href;
    }
  } catch {
    // Invalid and non-allowlisted URLs are rendered as inert links.
  }
  return "#";
};

const safeHref = (value = "") => escapeHtml(normalizeSafeUrl(value));

const number = (value) => new Intl.NumberFormat("ko-KR").format(Number(value || 0));
const money = (value) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format(Number.isFinite(Number(value)) ? Number(value) : 0);

const shortDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(date);
};

const dateOnly = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(date);
};

const officialityLabel = {
  official: "Official",
  provider_reported: "Provider",
  third_party: "Third-party",
};

const officialityClass = {
  official: "tag-official",
  provider_reported: "tag-provider",
  third_party: "tag-third",
};

const statusLabel = {
  implemented: "Implemented",
  spec_only: "Spec only",
  blocked: "Blocked",
};

function codePresentation(codeState) {
  if (["official_source", "third_party_source", "source_available", "example_available"].includes(codeState)) {
    return ["code-source", "source available"];
  }
  if (["docs_only", "documentation", "addresses_and_docs"].includes(codeState)) {
    return ["code-docs", "docs / reference"];
  }
  if (["external_service", "provider_integration", "provider_reported", "managed_service", "not_applicable"].includes(codeState)) {
    return ["code-service", "service / external"];
  }
  if (["source_rejected", "verified_contracts_no_repo"].includes(codeState)) {
    return ["code-rejected", codeState === "source_rejected" ? "source rejected" : "no repo found"];
  }
  return ["code-docs", String(codeState || "unknown").replaceAll("_", " ")];
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

async function copyText(text, confirmation) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(confirmation);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    showToast(confirmation);
  }
}

function renderOverview(catalog) {
  const { project, metrics, safety, network_observation: observation } = catalog;
  $("#project-decision").textContent = project.decision;
  $("#product-hypothesis").textContent = project.product_hypothesis;
  $("#fee-policy").textContent = project.fee_policy;
  $("#safety-notice").textContent = safety.notice;

  $("#metric-sources").textContent = number(metrics.registered_sources);
  $("#metric-research").innerHTML = `<i class="signal-up"></i> ${number(metrics.research_sessions)} strict research sessions`;
  $("#metric-verified").textContent = number(metrics.verified_claims);
  $("#metric-open-claims").textContent = `${number(metrics.unresolved_claims)} unresolved · ${number(metrics.refuted_claims)} refuted`;
  $("#metric-ecosystem").textContent = number(metrics.ecosystem_entries);
  $("#metric-official").textContent = `${metrics.official_entries} official · ${metrics.third_party_entries} third-party`;
  $("#metric-build").textContent = `${metrics.implemented_tracks}/${metrics.total_tracks}`;
  $("#catalog-revision").textContent = `Catalog ${catalog.catalog_revision} · ${catalog.as_of}`;

  if (observation) {
    $("#network-chain-id").textContent = number(observation.chain_id);
    $("#network-block").textContent = `#${number(observation.block_number)}`;
    $("#network-client").textContent = String(observation.client_version || "—").split("/")[0];
    $("#network-client").title = observation.client_version || "";
    $("#network-observed").textContent = shortDate(observation.observed_at);
  }
  $("#official-check-date").textContent = `Checked ${catalog.as_of}`;
}

function filteredEcosystem() {
  const entries = state.catalog?.ecosystem || [];
  const query = state.query.trim().toLocaleLowerCase("ko-KR");
  return entries.filter((entry) => {
    const inFilter = state.filter === "all" || entry.officiality === state.filter;
    const haystack = [entry.name, entry.category, entry.status, entry.summary, entry.code_state, ...(entry.limitations || [])]
      .join(" ")
      .toLocaleLowerCase("ko-KR");
    return inFilter && (!query || haystack.includes(query));
  });
}

function renderEcosystem() {
  const entries = filteredEcosystem();
  const body = $("#ecosystem-rows");
  const empty = $("#ecosystem-empty");
  body.hidden = entries.length === 0;
  empty.hidden = entries.length > 0;
  $("#ecosystem-count").textContent = `${number(entries.length)} / ${number(state.catalog.ecosystem.length)} records`;
  body.innerHTML = entries.map((entry) => {
    const [codeClass, codeLabel] = codePresentation(entry.code_state);
    return `
      <tr tabindex="0" data-entry-id="${escapeHtml(entry.id)}" aria-label="${escapeHtml(entry.name)} 상세 보기">
        <td class="project-cell"><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.summary)}</small></td>
        <td><span class="table-tag ${officialityClass[entry.officiality] || ""}"><i></i>${escapeHtml(officialityLabel[entry.officiality] || entry.officiality)}</span></td>
        <td><span class="status-text">${escapeHtml(entry.status.replaceAll("_", " "))}</span></td>
        <td><span class="code-tag ${codeClass}"><i></i>${escapeHtml(codeLabel)}</span></td>
        <td><span class="evidence-count">${number(entry.source_count)}</span></td>
        <td><span class="row-arrow" aria-hidden="true">↗</span></td>
      </tr>`;
  }).join("");
}

function openDrawer(entryId, trigger) {
  const entry = state.catalog.ecosystem.find((item) => item.id === entryId);
  if (!entry) return;
  state.lastFocused = trigger || document.activeElement;
  const [codeClass, codeLabel] = codePresentation(entry.code_state);
  const contracts = (entry.contracts || []).map((address) => `<li><code class="contract-address" title="${escapeHtml(address)}">${escapeHtml(address)}</code></li>`).join("");
  const limitations = (entry.limitations || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const links = (entry.links || []).map((link) => `<a href="${safeHref(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)} ↗</a>`).join("");
  $("#drawer-content").innerHTML = `
    <div class="drawer-title-row">
      <div><h2 id="drawer-title">${escapeHtml(entry.name)}</h2><p class="drawer-subtitle">${escapeHtml(entry.summary)}</p></div>
    </div>
    <dl class="drawer-meta">
      <div><dt>Officiality</dt><dd>${escapeHtml(officialityLabel[entry.officiality] || entry.officiality)}</dd></div>
      <div><dt>Category</dt><dd>${escapeHtml(entry.category)}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(entry.status.replaceAll("_", " "))}</dd></div>
      <div><dt>Code</dt><dd><span class="code-tag ${codeClass}"><i></i>${escapeHtml(codeLabel)}</span></dd></div>
      <div><dt>Evidence</dt><dd>${number(entry.source_count)} source IDs</dd></div>
      <div><dt>Addresses</dt><dd>${number(entry.contract_count)} catalogued</dd></div>
      <div><dt>Address state</dt><dd>${escapeHtml((entry.address_state || "unknown").replaceAll("_", " "))}</dd></div>
    </dl>
    <div class="drawer-block"><h3>Known limitations</h3><ul>${limitations || "<li>등록된 제한사항 없음</li>"}</ul></div>
    ${contracts ? `<div class="drawer-block"><h3>Catalogued addresses · not re-verified here</h3><ul>${contracts}</ul></div>` : ""}
    <div class="drawer-block"><h3>Primary links</h3><div class="drawer-links">${links || "<span class='status-text'>직접 링크 미등록</span>"}</div></div>
    <div class="safety-lock">research_only=true · strategy_consumption_allowed=false · order_input=false</div>`;
  const drawer = $("#detail-drawer");
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  $("[data-close-drawer]", drawer).focus();
}

function closeDrawer() {
  const drawer = $("#detail-drawer");
  if (!drawer.classList.contains("is-open")) return;
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  state.lastFocused?.focus?.();
}

function renderOfficialResources(catalog) {
  $("#official-resource-grid").innerHTML = catalog.official_resources.map((resource) => {
    const [, codeLabel] = codePresentation(resource.code_state);
    return `
      <article class="resource-card">
        <div class="resource-card-top"><span><i></i>${escapeHtml(resource.type.replaceAll("_", " "))}</span><span>${escapeHtml(codeLabel)}</span></div>
        <h4>${escapeHtml(resource.name)}</h4>
        <p>${escapeHtml(resource.note)}</p>
        <a class="evidence-link" href="${safeHref(resource.url)}" target="_blank" rel="noopener noreferrer">외부 원문 근거 ↗</a>
      </article>`;
  }).join("");
}

function renderInfrastructure(catalog) {
  const infra = catalog.infrastructure || {};
  const pool = catalog.pool_blueprint || {};
  $("#infra-headline").textContent = infra.headline || "노드 근거가 등록되지 않았습니다.";
  $("#node-profile").innerHTML = (infra.profile || []).map((item) => `
    <div data-state="${escapeHtml(item.state)}">
      <dt>${escapeHtml(item.label)}</dt>
      <dd>${escapeHtml(item.value)}</dd>
    </div>`).join("") || "<div><dt>Status</dt><dd>Not catalogued</dd></div>";
  $("#infra-links").innerHTML = (infra.links || []).map((link) => `
    <a href="${safeHref(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)} ↗</a>`).join("");
  $("#node-topology").innerHTML = (infra.topology || []).map((item, index) => `
    <li data-state="${escapeHtml(item.state)}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div>
    </li>`).join("") || "<li>Topology not catalogued</li>";

  $("#pool-headline").textContent = pool.headline || "풀 구조가 등록되지 않았습니다.";
  $("#pool-notice").textContent = pool.observed_notice || "테스트넷 관찰은 공식성 또는 안전성을 증명하지 않습니다.";
  $("#pool-components").innerHTML = (pool.components || []).map((item) => `
    <tr>
      <td class="project-cell"><strong>${escapeHtml(item.name)}</strong></td>
      <td><span class="table-tag layer-tag">${escapeHtml(item.layer)}</span></td>
      <td>${escapeHtml(item.role)}</td>
      <td><span class="status-text">${escapeHtml(item.external_evidence.replaceAll("_", " "))}</span></td>
      <td><span class="code-tag ${item.local_state === "not_implemented" || item.local_state === "blocked" ? "code-rejected" : "code-docs"}"><i></i>${escapeHtml(item.local_state.replaceAll("_", " "))}</span></td>
      <td>${escapeHtml(item.gate)}</td>
    </tr>`).join("") || '<tr class="loading-row"><td colspan="6">등록된 구성요소가 없습니다.</td></tr>';
  $("#pool-flows").innerHTML = (pool.flows || []).map((flow) => `
    <article class="flow-card">
      <h4>${escapeHtml(flow.name)}</h4>
      <ol>${flow.steps.map((step) => `<li><span>${escapeHtml(step)}</span></li>`).join("")}</ol>
    </article>`).join("");
}

function calculatorValues() {
  const volume = Math.max(0, Number($("#calc-volume").value) || 0);
  const feeBps = Math.max(0, Number($("#calc-fee").value) || 0);
  const share = Math.min(100, Math.max(0, Number($("#calc-share").value) || 0));
  const cost = Math.max(0, Number($("#calc-cost").value) || 0);
  const gross = volume * feeBps / 10000;
  const recipient = gross * share / 100;
  const net = recipient - cost;
  const takeRate = feeBps / 10000 * share / 100;
  const breakEven = takeRate > 0 ? cost / takeRate : 0;
  return { gross, recipient, net, breakEven };
}

function renderCalculator() {
  const { gross, recipient, net, breakEven } = calculatorValues();
  $("#calc-gross").textContent = money(gross);
  $("#calc-recipient").textContent = money(recipient);
  $("#calc-net").textContent = money(net);
  $("#calc-net").classList.toggle("is-negative", net < 0);
  $("#calc-break-even").textContent = breakEven ? money(breakEven) : "—";
}

function applyPreset(preset) {
  $("#calc-fee").value = preset.fee_bps;
  $("#calc-share").value = preset.recipient_share_percent;
  $("#calc-recipient-label").textContent = `${preset.recipient} 총액`;
  renderCalculator();
  showToast(`${preset.label} 공개 산식을 적용했습니다. 권고값은 아닙니다.`);
}

function renderRevenue(catalog) {
  const revenue = catalog.revenue;
  if (!revenue) {
    $("#revenue-thesis").innerHTML = '<div><p class="mini-label">RESEARCH IN PROGRESS</p><h3>검증된 수익모델 데이터가 아직 생성되지 않았습니다.</h3><p>완료 전 숫자를 제품 판단에 사용하지 않습니다.</p></div>';
    $("#revenue-models").innerHTML = '<div class="empty-state"><strong>수익모델 리서치 진행 중</strong></div>';
    $("#case-studies").innerHTML = '<tr class="loading-row"><td colspan="6">검증 완료 후 사례가 표시됩니다.</td></tr>';
    renderCalculator();
    return;
  }

  const thesis = revenue.recommendation || {};
  $("#revenue-thesis").innerHTML = `
    <div><p class="mini-label">RECOMMENDATION · ${escapeHtml(thesis.confidence || "")}</p><h3>${escapeHtml(thesis.headline)}</h3><p>${escapeHtml(thesis.summary)}</p></div>
    <div class="thesis-tags">${(thesis.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>`;

  $("#revenue-models").innerHTML = (revenue.models || []).map((model) => `
    <article class="revenue-card" data-priority="${escapeHtml(model.priority)}">
      <div class="revenue-card-head"><span>${escapeHtml(model.category)}</span><span class="priority-tag">${escapeHtml(model.priority)}</span></div>
      <h3>${escapeHtml(model.name)}</h3>
      <p>${escapeHtml(model.verdict)}</p>
      <dl>
        <div><dt>Payer</dt><dd>${escapeHtml(model.payer)}</dd></div>
        <div><dt>Operator earns</dt><dd>${escapeHtml(model.operator_revenue)}</dd></div>
        <div><dt>Formula</dt><dd><code>${escapeHtml(model.formula)}</code></dd></div>
        <div><dt>Hard gate</dt><dd>${escapeHtml(model.hard_gate)}</dd></div>
      </dl>
      <div class="risk-line"><strong>RISK</strong><span>${escapeHtml(model.primary_risk)}</span></div>
      <div class="benchmark-links">${(model.links || []).map((link) => `<a href="${safeHref(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)} ↗</a>`).join("")}</div>
    </article>`).join("");

  $("#calculator-presets").innerHTML = (revenue.calculator_presets || []).map((preset, index) => `
    <button type="button" data-preset-index="${index}" title="${escapeHtml(preset.basis)}">${escapeHtml(preset.label)}</button>`).join("");
  $$('[data-preset-index]', $("#calculator-presets")).forEach((button) => button.addEventListener("click", () => {
    applyPreset(revenue.calculator_presets[Number(button.dataset.presetIndex)]);
  }));

  $("#revenue-sequence").innerHTML = (revenue.sequence || []).map((item) => `
    <li data-status="${escapeHtml(item.status)}"><span>${escapeHtml(item.phase)}</span><div><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.action)}</p><small>GATE · ${escapeHtml(item.gate)}</small></div></li>`).join("");

  $("#case-studies").innerHTML = (revenue.case_studies || []).map((item) => `
    <tr>
      <td class="project-cell"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.network)} · ${escapeHtml(item.period)}</small></td>
      <td>${escapeHtml(item.launch_mechanism)}</td>
      <td>${escapeHtml(item.follow_on)}</td>
      <td>${escapeHtml(item.revenue_capture)}</td>
      <td><strong class="case-evidence">${escapeHtml(item.evidence)}</strong><small class="case-boundary">${escapeHtml(item.boundary)}</small></td>
      <td><div class="case-links">${(item.links || []).map((link) => `<a href="${safeHref(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(item.name)} ${escapeHtml(link.label)}">↗</a>`).join("")}</div></td>
    </tr>`).join("");
  $("#revenue-as-of").textContent = `As of ${revenue.as_of}`;
  renderCalculator();
}

function renderBuildTracks(catalog) {
  const icon = { implemented: "✓", spec_only: "◇", blocked: "×" };
  $("#build-board").innerHTML = catalog.build_tracks.map((track) => {
    const files = track.files.map((file) => `
      <a class="file-link ${file.exists ? "" : "is-missing"}" href="${safeHref(file.url)}" title="${escapeHtml(file.path)}">
        <span>${escapeHtml(file.label)}</span><b aria-hidden="true">↗</b>
      </a>`).join("");
    return `
      <article class="build-track" data-status="${escapeHtml(track.status)}">
        <div class="track-name">
          <span class="track-state ${escapeHtml(track.status)}">${icon[track.status] || "?"}</span>
          <div><strong>${escapeHtml(track.name)}</strong><small>${escapeHtml(statusLabel[track.status] || track.status)}</small></div>
        </div>
        <div class="track-summary"><p>${escapeHtml(track.summary)}</p><div class="progress-line"><i style="width:${Math.max(0, Math.min(100, track.progress))}%"></i></div></div>
        <div class="track-links">${files}</div>
        <div class="track-next"><strong>NEXT</strong><span>${escapeHtml(track.next)}</span></div>
      </article>`;
  }).join("");
}

function renderResearch(catalog) {
  $("#research-grid").innerHTML = catalog.research.map((session) => {
    const links = session.links.filter((link) => link.exists).map((link) => `<a href="${safeHref(link.url)}">${escapeHtml(link.label)} →</a>`).join("");
    const verdict = session.verdict || "NOT_EVALUATED";
    const verdictState = verdict === "PASS" ? "pass" : verdict === "FAIL" ? "fail" : "pending";
    return `
      <article class="research-card">
        <div class="research-card-head"><span class="research-date">${escapeHtml(dateOnly(session.updated_at))}</span><span class="verdict" data-verdict="${verdictState}">${escapeHtml(verdict)}</span></div>
        <h3>${escapeHtml(session.title)}</h3>
        <p>${escapeHtml(session.description)}</p>
        <div class="research-stats">
          <div><strong>${number(session.source_count)}</strong><span>Sources</span></div>
          <div><strong>${number(session.verified_count)}</strong><span>Verified</span></div>
          <div><strong>${number(session.unresolved_count)}</strong><span>Open</span></div>
        </div>
        <div class="research-links">${links}</div>
      </article>`;
  }).join("");

  $("#document-groups").innerHTML = catalog.document_groups.map((group) => {
    const files = group.files.map((file) => `<li><a href="${safeHref(file.url)}"><span>${escapeHtml(file.label)}</span><span aria-hidden="true">→</span></a></li>`).join("");
    return `<article class="document-group"><h4>${escapeHtml(group.name)}</h4><p>${escapeHtml(group.description)}</p><ul>${files}</ul></article>`;
  }).join("");
}

function renderGates(catalog) {
  $("#gate-score").textContent = `0 / ${catalog.mainnet_gates.length}`;
  $("#gate-list").innerHTML = catalog.mainnet_gates.map((gate) => `
    <li class="gate-item"><div><strong>${escapeHtml(gate.text)}</strong><span>${escapeHtml(gate.state)} · evidence required</span></div></li>`).join("");
}

function renderError(error) {
  console.error(error);
  $("#ecosystem-rows").innerHTML = '<tr class="loading-row"><td colspan="6">데이터를 불러오지 못했습니다. GitHub Pages 경로 또는 catalog.json을 확인해 주세요.</td></tr>';
  $("#build-board").innerHTML = '<div class="empty-state"><strong>개발 보드를 불러오지 못했습니다.</strong></div>';
  $("#research-grid").innerHTML = '<div class="empty-state"><strong>리서치 인덱스를 불러오지 못했습니다.</strong></div>';
}

function bindInteractions() {
  $("#copy-probe").addEventListener("click", () => copyText(PROBE_COMMAND, "읽기 전용 프로브 명령을 복사했습니다."));
  $("#copy-checks").addEventListener("click", () => copyText(CHECK_COMMANDS, "전체 검증 명령을 복사했습니다."));
  ["#calc-volume", "#calc-fee", "#calc-share", "#calc-cost"].forEach((selector) => {
    $(selector).addEventListener("input", renderCalculator);
  });

  $("#ecosystem-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderEcosystem();
  });

  $$(".filter-chip").forEach((button) => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    $$(".filter-chip").forEach((item) => item.classList.toggle("is-active", item === button));
    renderEcosystem();
  }));

  $("#ecosystem-rows").addEventListener("click", (event) => {
    const row = event.target.closest("[data-entry-id]");
    if (row) openDrawer(row.dataset.entryId, row);
  });
  $("#ecosystem-rows").addEventListener("keydown", (event) => {
    const row = event.target.closest("[data-entry-id]");
    if (row && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      openDrawer(row.dataset.entryId, row);
    }
  });

  $$('[data-close-drawer]').forEach((button) => button.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (document.body.dataset.page !== "research") {
        window.location.assign("./research.html#ecosystem");
        return;
      }
      $("#ecosystem-search").focus();
      $("#ecosystem").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  const navLinks = $$(".nav-link");
  const currentPage = document.body.dataset.page || "overview";
  navLinks.forEach((link) => {
    const active = link.dataset.pageLink === currentPage;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function renderLaunch(catalog) {
  const lp = catalog.launch_prep;
  const headline = $("#launch-headline");
  if (!headline) return;
  if (!lp) {
    headline.textContent = "론칭 준비 데이터가 아직 생성되지 않았습니다.";
    return;
  }
  headline.textContent = lp.headline || "";
  $("#launch-asof").textContent = `as of ${lp.as_of || "—"}`;
  const decision = lp.decision || {};
  const decisionCard = (block, cls) => block ? `<article class="decision-card ${cls}"><h4>${escapeHtml(block.title)}</h4><ol>${(block.points || []).map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ol></article>` : "";
  $("#launch-decision").innerHTML = [decisionCard(decision.market_read, "is-market"), decisionCard(decision.do_now, "is-now"), decisionCard(decision.product, "is-product")].join("");
  const rh = lp.robinhood || {};
  $("#launch-chain-id").textContent = `chain ${rh.chain_id ?? "—"}`;
  $("#launch-stats").innerHTML = (rh.stats || []).map((item) => `
    <div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join("") || "<div><dt>Status</dt><dd>Not catalogued</dd></div>";
  $("#launch-stat-links").innerHTML = (rh.stats || []).filter((item) => item.source).map((item) => `
    <a href="${safeHref(item.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)} ↗</a>`).join("");
  $("#launch-funding").innerHTML = (rh.funding_paths || []).map((item, index) => `
    <li data-state="${escapeHtml(item.state || "unverified")}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div>
    </li>`).join("") || "<li>자금 경로가 등록되지 않았습니다.</li>";
  $("#launch-tools").innerHTML = (rh.bots_and_tools || []).map((tool) => `
    <a href="${safeHref(tool.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(tool.detail || "")}">${escapeHtml(tool.name)} ↗</a>`).join("");

  const cell = (value) => `<td>${escapeHtml(value || "—")}</td>`;
  const FACTS = [["공급 배분", "supply_split"], ["가상 유동성", "virtual_liquidity"], ["졸업 조건", "graduation"], ["졸업 시 LP", "lp_at_graduation"], ["LP 잠금", "lp_lock"], ["풀", "pool"], ["수수료", "fees"], ["생성비", "creation_fee"], ["dev-buy", "dev_buy"], ["스나이퍼 방어", "anti_snipe"], ["활동", "activity"]];
  $("#launch-pads").innerHTML = (lp.launchpads || []).map((pad, index) => `
    <article class="pad-card${index === 0 ? " is-first" : ""}">
      <div class="pad-card-head">
        <div><h4>${escapeHtml(pad.name)}</h4><small>${escapeHtml(pad.chain || "")}</small></div>
        <span class="pad-verdict">${escapeHtml(pad.verdict || "—")}</span>
      </div>
      <dl class="pad-facts">${FACTS.map(([label, key]) => pad[key] ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(pad[key])}</dd></div>` : "").join("")}</dl>
      ${pad.url ? `<a class="text-link" href="${safeHref(pad.url)}" target="_blank" rel="noopener noreferrer">문서 ↗</a>` : ""}
    </article>`).join("") || '<div class="empty-state"><strong>등록된 런치패드가 없습니다.</strong></div>';

  $("#launch-norms").innerHTML = (lp.norms || []).map((row) => `
    <tr>
      <td class="project-cell"><strong>${escapeHtml(row.platform)}</strong>${row.url ? `<br><a class="text-link" href="${safeHref(row.url)}" target="_blank" rel="noopener noreferrer">source ↗</a>` : ""}</td>
      ${cell(row.chain)}${cell(row.curve_percent)}${cell(row.lp_percent)}${cell(row.team_percent)}${cell(row.graduation)}${cell(row.lp_quote_at_graduation)}${cell(row.creator_fee)}
    </tr>`).join("") || '<tr class="loading-row"><td colspan="8">등록된 규범이 없습니다.</td></tr>';

  const rc = lp.recommended_composition || {};
  const notes = (rc.notes || []).map((note) => escapeHtml(note)).join(" · ");
  $("#launch-composition").innerHTML = rc.supply_split
    ? `공급 배분 <strong>${escapeHtml(rc.supply_split)}</strong> · dev-buy <strong>${escapeHtml(rc.dev_buy || "—")}</strong> · 수수료 <strong>${escapeHtml(rc.fee_option || "—")}</strong> · LP <strong>${escapeHtml(rc.lp_lock || "—")}</strong>${notes ? `<br><small>${notes}</small>` : ""}`
    : "권장 구성이 아직 없습니다.";

  $("#launch-playbook").innerHTML = (lp.playbook || []).map((phase) => `
    <article class="flow-card">
      <h4>${escapeHtml(phase.phase)}</h4>
      <ol>${(phase.steps || []).map((step) => `<li><span>${escapeHtml(step)}</span></li>`).join("")}</ol>
    </article>`).join("");

  $("#launch-costs").innerHTML = (lp.costs || []).map((item) => `
    <div><dt>${escapeHtml(item.item)}</dt><dd>${escapeHtml(item.eth || "—")}${item.usd ? ` · ${escapeHtml(item.usd)}` : ""}${item.note ? `<br><small>${escapeHtml(item.note)}</small>` : ""}</dd></div>`).join("") || "<div><dt>Costs</dt><dd>Not catalogued</dd></div>";

  const giwa = lp.giwa_parallel || {};
  const listBlock = (label, items) => (items && items.length) ? `<section><h4>${escapeHtml(label)}</h4><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : "";
  $("#launch-giwa").innerHTML = [
    listBlock("같은 것", giwa.same), listBlock("다른 것", giwa.different), listBlock("Sepolia 리허설", giwa.rehearsal_steps),
    listBlock("메인넷 임박 신호", giwa.mainnet_signals), listBlock("론칭 키트", giwa.launch_kit),
  ].join("") || "<section><h4>GIWA</h4><ul><li>Not catalogued</li></ul></section>";

  $("#launch-not-doing").innerHTML = (lp.not_doing || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>—</li>";
  $("#launch-sources").innerHTML = (lp.sources || []).map((source) => `
    <a href="${safeHref(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)}${source.observed ? ` · ${escapeHtml(source.observed)}` : ""} ↗</a>`).join("");
}

async function init() {
  bindInteractions();
  try {
    const response = await fetch(CATALOG_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`catalog fetch failed: ${response.status}`);
    state.catalog = await response.json();
    renderOverview(state.catalog);
    renderEcosystem();
    renderOfficialResources(state.catalog);
    renderInfrastructure(state.catalog);
    renderRevenue(state.catalog);
    renderBuildTracks(state.catalog);
    renderResearch(state.catalog);
    renderGates(state.catalog);
    renderLaunch(state.catalog);
  } catch (error) {
    renderError(error);
  }
}

init();
