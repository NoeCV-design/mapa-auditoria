// Browser-side code for extractStructuralFindings.
// Kept as plain JS so tsx/esbuild never transforms it — avoids __name() wrappers
// that cause ReferenceError when Playwright serialises TypeScript arrow functions.
//
// Exported as a string via structural-eval-loader.ts; called with:
//   page.evaluate(STRUCTURAL_EVAL_FN, excludeSel)

(function (exSel) {
  var inExcluded = function (el) { return exSel ? !!el.closest(exSel) : false; };

  // ── Document-level ────────────────────────────────────────────────────────
  var lang = document.documentElement.getAttribute("lang");
  var langValid = !!lang && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(lang);
  var hasTitle = !!document.title && !!document.title.trim();
  var ariaHiddenBody = document.body ? document.body.getAttribute("aria-hidden") === "true" : false;

  var idCounts = {};
  var allWithId = document.querySelectorAll("[id]");
  for (var i = 0; i < allWithId.length; i++) {
    if (inExcluded(allWithId[i])) continue;
    var id = allWithId[i].id;
    if (id) idCounts[id] = (idCounts[id] || 0) + 1;
  }
  var duplicateIds = [];
  for (var k in idCounts) {
    if (idCounts[k] > 1) duplicateIds.push(k);
    if (duplicateIds.length >= 5) break;
  }

  // ── Heading hierarchy ─────────────────────────────────────────────────────
  var allHeadings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .filter(function (el) { return !inExcluded(el); });
  var h1Samples = [];
  var h1Count = 0;
  var h1HiddenCount = 0;
  for (var i = 0; i < allHeadings.length; i++) {
    if (allHeadings[i].tagName === "H1") {
      h1Count++;
      var cs = window.getComputedStyle(allHeadings[i]);
      if (cs.display === "none" || cs.visibility === "hidden") h1HiddenCount++;
      if (h1Samples.length < 3)
        h1Samples.push((allHeadings[i].textContent || "").replace(/\s+/g, " ").trim().slice(0, 80));
    }
  }
  var hierarchyJumps = [];
  for (var i = 1; i < allHeadings.length; i++) {
    var prev = parseInt(allHeadings[i - 1].tagName[1], 10);
    var curr = parseInt(allHeadings[i].tagName[1], 10);
    if (curr > prev + 1) {
      hierarchyJumps.push({
        from: allHeadings[i - 1].tagName.toLowerCase(),
        to: allHeadings[i].tagName.toLowerCase(),
        nextText: (allHeadings[i].textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
      });
    }
    if (hierarchyJumps.length >= 5) break;
  }

  // ── Landmarks ─────────────────────────────────────────────────────────────
  var mainCount = Array.from(document.querySelectorAll("main, [role='main']"))
    .filter(function (el) { return !inExcluded(el); }).length;
  var navs = Array.from(document.querySelectorAll("nav, [role='navigation']"))
    .filter(function (el) { return !inExcluded(el); });
  var navsWithoutLabelSamples = [];
  var navsWithoutLabel = 0;
  for (var i = 0; i < navs.length; i++) {
    var n = navs[i];
    if (!n.getAttribute("aria-label") && !n.getAttribute("aria-labelledby")) {
      navsWithoutLabel++;
      if (navsWithoutLabelSamples.length < 3)
        navsWithoutLabelSamples.push(n.outerHTML.replace(/\s+/g, " ").trim().slice(0, 200));
    }
  }
  var asideInsideMain = Array.from(document.querySelectorAll("main aside, [role='main'] aside"))
    .filter(function (el) { return !inExcluded(el); }).length;

  // ── Non-semantic interactive ───────────────────────────────────────────────
  var interactiveDivs = Array.from(document.querySelectorAll(
    "div[role='button'], span[role='button'], div[onclick], span[onclick]"
  )).filter(function (el) { return !inExcluded(el); });
  var nonSemanticSamples = [];
  for (var i = 0; i < Math.min(3, interactiveDivs.length); i++)
    nonSemanticSamples.push(interactiveDivs[i].outerHTML.replace(/\s+/g, " ").trim().slice(0, 200));

  // ── Anchors misused ────────────────────────────────────────────────────────
  var hashLinks = Array.from(document.querySelectorAll('a[href="#"], a[href=""]'))
    .filter(function (el) { return !inExcluded(el); });
  var hashOnlySamples = [];
  for (var i = 0; i < Math.min(3, hashLinks.length); i++)
    hashOnlySamples.push(hashLinks[i].outerHTML.replace(/\s+/g, " ").trim().slice(0, 200));
  var withoutHrefElements = Array.from(document.querySelectorAll("a:not([href])"))
    .filter(function (el) { return !inExcluded(el); });
  var withoutHref = withoutHrefElements.length;
  var withoutHrefSamples = [];
  for (var i = 0; i < Math.min(3, withoutHrefElements.length); i++)
    withoutHrefSamples.push(withoutHrefElements[i].outerHTML.replace(/\s+/g, " ").trim().slice(0, 200));

  // ── Positive tabindex ──────────────────────────────────────────────────────
  var allTabindex = Array.from(document.querySelectorAll("[tabindex]"))
    .filter(function (el) { return !inExcluded(el); });
  var tabindexPositiveEls = [];
  for (var i = 0; i < allTabindex.length; i++) {
    var v = parseInt(allTabindex[i].getAttribute("tabindex") || "", 10);
    if (!isNaN(v) && v > 0) tabindexPositiveEls.push(allTabindex[i]);
  }
  var tabindexPositiveSamples = [];
  for (var i = 0; i < Math.min(3, tabindexPositiveEls.length); i++)
    tabindexPositiveSamples.push(tabindexPositiveEls[i].outerHTML.replace(/\s+/g, " ").trim().slice(0, 200));

  // ── Forms: inputs without label ────────────────────────────────────────────
  var formInputs = Array.from(document.querySelectorAll(
    "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']), select, textarea"
  )).filter(function (el) { return !inExcluded(el); });
  var inputsWithoutLabelList = [];
  for (var i = 0; i < formInputs.length; i++) {
    var input = formInputs[i];
    if (input.getAttribute("aria-label") || input.getAttribute("aria-labelledby") || input.getAttribute("title")) continue;
    if (input.id && document.querySelector('label[for="' + CSS.escape(input.id) + '"]')) continue;
    if (input.closest("label")) continue;
    inputsWithoutLabelList.push(input);
  }
  var inputsWithoutLabelSamples = [];
  for (var i = 0; i < Math.min(3, inputsWithoutLabelList.length); i++)
    inputsWithoutLabelSamples.push(inputsWithoutLabelList[i].outerHTML.replace(/\s+/g, " ").trim().slice(0, 200));

  // ── Radio/checkbox groups without fieldset ─────────────────────────────────
  var groups = {};
  var radioCheckboxInputs = Array.from(document.querySelectorAll("input[type='radio'], input[type='checkbox']"))
    .filter(function (el) { return !inExcluded(el); });
  for (var i = 0; i < radioCheckboxInputs.length; i++) {
    var el = radioCheckboxInputs[i];
    if (!el.name) continue;
    if (!groups[el.name]) groups[el.name] = [];
    groups[el.name].push(el);
  }
  var radioCheckboxGroupsWithoutFieldset = 0;
  for (var name in groups) {
    var group = groups[name];
    if (group.length < 2) continue;
    var allInFieldset = true;
    for (var i = 0; i < group.length; i++) {
      if (!group[i].closest("fieldset")) { allInFieldset = false; break; }
    }
    if (!allInFieldset) radioCheckboxGroupsWithoutFieldset++;
  }

  // ── Data tables without headers ────────────────────────────────────────────
  var tables = Array.from(document.querySelectorAll("table"))
    .filter(function (el) { return !inExcluded(el); });
  var dataTablesWithoutHeaders = 0;
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    if (t.querySelectorAll("tr").length < 2) continue;
    if (!t.querySelector("th") && !t.querySelector("caption")) dataTablesWithoutHeaders++;
  }

  return {
    document: { lang: lang, langValid: langValid, hasTitle: hasTitle, ariaHiddenBody: ariaHiddenBody, duplicateIds: duplicateIds },
    headings: { h1Count: h1Count, h1HiddenCount: h1HiddenCount, h1Samples: h1Samples, hierarchyJumps: hierarchyJumps },
    landmarks: {
      mainCount: mainCount,
      navCount: navs.length,
      navsWithoutLabel: navsWithoutLabel,
      navsWithoutLabelSamples: navsWithoutLabelSamples,
      asideInsideMain: asideInsideMain,
    },
    nonSemanticInteractive: { count: interactiveDivs.length, samples: nonSemanticSamples },
    anchorsMisused: { hashOnly: hashLinks.length, hashOnlySamples: hashOnlySamples, withoutHref: withoutHref, withoutHrefSamples: withoutHrefSamples },
    tabindex: { positive: tabindexPositiveEls.length, positiveSamples: tabindexPositiveSamples },
    forms: {
      inputsWithoutLabel: inputsWithoutLabelList.length,
      inputsWithoutLabelSamples: inputsWithoutLabelSamples,
      radioCheckboxGroupsWithoutFieldset: radioCheckboxGroupsWithoutFieldset,
    },
    tables: { dataTablesWithoutHeaders: dataTablesWithoutHeaders },
  };
})
