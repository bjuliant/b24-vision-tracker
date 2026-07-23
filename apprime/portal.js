(() => {
  "use strict";

  const config = window.B24_CONFIG || {};
  const configured = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY && window.supabase);
  const client = configured
    ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
    : null;
  const page = document.body.dataset.page || "";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function setStatus(element, message, kind = "") {
    if (!element) return;
    element.textContent = message;
    element.className = `form-status ${kind}`.trim();
  }

  function rankFor(points) {
    if (points >= 5000) return "Strategos";
    if (points >= 2500) return "Polemarch";
    if (points >= 1200) return "Trierarch";
    if (points >= 500) return "Lochagos";
    if (points >= 150) return "Hoplite";
    return "Recruit";
  }

  async function currentSession() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session || null;
  }

  async function currentProfile(session) {
    if (!client || !session) return null;
    const { data } = await client
      .from("apprime_profiles")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();
    return data || null;
  }

  async function updateAccountLinks(session) {
    $$(".account-link").forEach((link) => {
      link.textContent = session ? "Member account" : "Member login";
    });
  }

  async function initArchive() {
    const form = $("#communityUploadForm");
    const status = $("#uploadStatus");
    const gallery = $("#communityGallery");
    const configNotice = $("#archiveConfigNotice");

    if (!client) {
      if (configNotice) configNotice.hidden = false;
      if (form) {
        [...form.elements].forEach((element) => { element.disabled = true; });
      }
      if (gallery) gallery.innerHTML = '<div class="empty-state">Community uploads will appear after the site database is connected.</div>';
      return;
    }

    await loadCommunityGallery(gallery);

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const file = $("#graphicFile")?.files?.[0];
      const title = $("#graphicTitle")?.value.trim();
      const submitterName = $("#graphicSubmitter")?.value.trim() || "Anonymous";
      const description = $("#graphicDescription")?.value.trim() || "";
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];

      if (!file || !title) return setStatus(status, "Choose an image and provide a title.", "error");
      if (!allowed.includes(file.type)) return setStatus(status, "Use PNG, JPEG, WebP, or GIF.", "error");
      if (file.size > 8 * 1024 * 1024) return setStatus(status, "Images must be 8 MB or smaller.", "error");

      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      setStatus(status, "Uploading artwork for review...");

      const session = await currentSession();
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
      const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await client.storage
        .from("apprime-community")
        .upload(path, file, { cacheControl: "3600", upsert: false });

      if (uploadError) {
        button.disabled = false;
        return setStatus(status, uploadError.message, "error");
      }

      const { error: recordError } = await client.from("apprime_graphics").insert({
        submitter_id: session?.user?.id || null,
        submitter_name: submitterName,
        title,
        description,
        storage_path: path
      });

      button.disabled = false;
      if (recordError) return setStatus(status, recordError.message, "error");
      form.reset();
      setStatus(status, "Upload received. It will appear publicly after review.", "success");
    });
  }

  async function loadCommunityGallery(gallery) {
    if (!gallery) return;
    gallery.innerHTML = '<div class="empty-state">Loading community artwork...</div>';
    const { data, error } = await client
      .from("apprime_graphics")
      .select("id,title,description,submitter_name,storage_path,created_at")
      .eq("status", "approved")
      .eq("official", false)
      .order("created_at", { ascending: false })
      .limit(60);

    if (error) {
      gallery.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
      return;
    }
    if (!data?.length) {
      gallery.innerHTML = '<div class="empty-state">No community artwork has been approved yet. Be the first to submit something.</div>';
      return;
    }

    const signed = await Promise.all(data.map(async (item) => {
      const { data: urlData } = await client.storage
        .from("apprime-community")
        .createSignedUrl(item.storage_path, 3600);
      return { ...item, url: urlData?.signedUrl || "" };
    }));

    gallery.innerHTML = signed.map((item) => `
      <article class="community-card">
        ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.title)}" loading="lazy"></a>` : ""}
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.description || "Community contribution")}</p>
          <p class="micro">Submitted by ${escapeHtml(item.submitter_name)}</p>
        </div>
      </article>
    `).join("");
  }

  async function initMembers() {
    const membersBody = $("#memberRows");
    const authGate = $("#authGate");
    const memberPanel = $("#memberPanel");
    const authForm = $("#authForm");
    const authStatus = $("#authStatus");
    const profileForm = $("#profileForm");
    const profileStatus = $("#profileStatus");
    const awardPanel = $("#awardPanel");
    const awardForm = $("#awardForm");
    const awardStatus = $("#awardStatus");
    const reviewPanel = $("#reviewPanel");
    const reviewQueue = $("#reviewQueue");
    const reviewStatus = $("#reviewStatus");
    const signOut = $("#signOut");

    if (!client) {
      if (authGate) authGate.innerHTML = "Connect Supabase in config.js to activate member login and ranking.";
      if (membersBody) membersBody.innerHTML = '<tr><td colspan="4">Member records will appear after setup.</td></tr>';
      return;
    }

    const loadMembers = async () => {
      const { data, error } = await client
        .from("apprime_profiles")
        .select("id,display_name,telegram_username,role,points")
        .order("points", { ascending: false })
        .order("display_name");
      if (error || !membersBody) return;
      membersBody.innerHTML = data?.length
        ? data.map((member, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(member.display_name)}</td>
            <td><span class="rank-chip">${rankFor(member.points)}</span></td>
            <td>${Number(member.points).toLocaleString()}</td>
          </tr>
        `).join("")
        : '<tr><td colspan="4">No members have enrolled yet.</td></tr>';
      const select = $("#awardMember");
      if (select) {
        select.innerHTML = data.map((member) =>
          `<option value="${member.id}">${escapeHtml(member.display_name)} — ${member.points} pts</option>`
        ).join("");
      }
    };

    const loadReviewQueue = async () => {
      if (!reviewQueue || !profile || !["officer", "admin"].includes(profile.role)) return;
      const { data, error } = await client
        .from("apprime_graphics")
        .select("id,title,description,submitter_name,storage_path,created_at")
        .eq("status", "pending")
        .order("created_at")
        .limit(50);
      if (error) {
        reviewQueue.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
        return;
      }
      const withUrls = await Promise.all((data || []).map(async (item) => {
        const { data: urlData } = await client.storage
          .from("apprime-community")
          .createSignedUrl(item.storage_path, 1800);
        return { ...item, url: urlData?.signedUrl || "" };
      }));
      reviewQueue.innerHTML = withUrls.length
        ? withUrls.map((item) => `
          <article class="review-item" data-graphic-id="${item.id}">
            ${item.url ? `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.title)}">` : ""}
            <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.submitter_name)} · ${escapeHtml(item.description || "No description")}</p></div>
            <div class="action-row">
              <button class="portal-button" type="button" data-review="approved">Approve</button>
              <button class="portal-button primary" type="button" data-review="rejected">Reject</button>
            </div>
          </article>
        `).join("")
        : "<p>No pending submissions.</p>";
    };

    await loadMembers();
    let session = await currentSession();
    let profile = await currentProfile(session);

    const renderAccount = () => {
      if (authGate) authGate.hidden = Boolean(session);
      if (memberPanel) memberPanel.hidden = !session;
      if (awardPanel) awardPanel.hidden = !profile || !["officer", "admin"].includes(profile.role);
      if (reviewPanel) reviewPanel.hidden = !profile || !["officer", "admin"].includes(profile.role);
      if (session) {
        $("#profileName").value = profile?.display_name || "";
        $("#profileTelegram").value = profile?.telegram_username || "";
        $("#accountEmail").textContent = session.user.email || "";
        $("#accountRank").textContent = `${rankFor(profile?.points || 0)} · ${(profile?.points || 0).toLocaleString()} points`;
      }
    };
    renderAccount();
    await loadReviewQueue();

    authForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = $("#authEmail").value.trim();
      if (!email) return;
      setStatus(authStatus, "Sending secure sign-in link...");
      const { error } = await client.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: new URL("./members.html", location.href).href
        }
      });
      setStatus(
        authStatus,
        error ? error.message : "Check your email for the secure sign-in link.",
        error ? "error" : "success"
      );
    });

    profileForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const { error } = await client.rpc("update_apprime_profile", {
        next_display_name: $("#profileName").value.trim(),
        next_telegram_username: $("#profileTelegram").value.trim().replace(/^@/, "")
      });
      if (!error) {
        profile = await currentProfile(session);
        renderAccount();
        await loadMembers();
      }
      setStatus(profileStatus, error ? error.message : "Profile updated.", error ? "error" : "success");
    });

    awardForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const { error } = await client.rpc("award_apprime_points", {
        target_member: $("#awardMember").value,
        point_delta: Number($("#awardPoints").value),
        award_reason: $("#awardReason").value.trim()
      });
      if (!error) {
        awardForm.reset();
        await loadMembers();
      }
      setStatus(awardStatus, error ? error.message : "Points awarded and recorded.", error ? "error" : "success");
    });

    reviewQueue?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-review]");
      const item = event.target.closest("[data-graphic-id]");
      if (!button || !item) return;
      button.disabled = true;
      const { error } = await client.rpc("review_apprime_graphic", {
        graphic_id: item.dataset.graphicId,
        next_status: button.dataset.review
      });
      setStatus(reviewStatus, error ? error.message : `Submission ${button.dataset.review}.`, error ? "error" : "success");
      await loadReviewQueue();
    });

    signOut?.addEventListener("click", async () => {
      await client.auth.signOut();
      session = null;
      profile = null;
      renderAccount();
      updateAccountLinks(null);
    });

    client.auth.onAuthStateChange(async (_event, nextSession) => {
      session = nextSession;
      profile = await currentProfile(session);
      renderAccount();
      updateAccountLinks(session);
      await loadReviewQueue();
    });
  }

  async function initWarRoom() {
    const gate = $("#mapAuthGate");
    const board = $("#galaxyBoard");
    const account = $("#mapAccount");
    if (!client) {
      if (gate) gate.innerHTML = 'Connect Supabase in <code>config.js</code> to activate the protected theater overview.';
      return;
    }
    const session = await currentSession();
    if (!session) return;

    if (gate) gate.hidden = true;
    if (account) {
      account.hidden = false;
      account.textContent = session.user.email || "Signed-in member";
    }
    if (!board) return;
    board.hidden = false;
    board.innerHTML = Array.from({ length: 50 }, (_, index) => {
      const galaxy = `B${String(index + 1).padStart(2, "0")}`;
      const cells = Array.from({ length: 100 }, () => "<i></i>").join("");
      return `
        <article class="galaxy-card">
          <header><span>${galaxy}</span><span>100 sectors</span></header>
          <div class="mini-galaxy" aria-label="${galaxy} sector overview">${cells}</div>
        </article>
      `;
    }).join("");
  }

  async function init() {
    const session = await currentSession();
    updateAccountLinks(session);
    if (page === "archive") await initArchive();
    if (page === "members") await initMembers();
    if (page === "war-room") await initWarRoom();
  }

  init();
})();
