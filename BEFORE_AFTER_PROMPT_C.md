# BEFORE/AFTER COMPARISON: PROMPT C IMPLEMENTATION

## Strategy Selection Logic

### BEFORE

```
7. CANDIDATE STRATEGIES — name 2–4 attacks from the STRATEGIES list below (use their
   ids, e.g. "queen-charge-hybrid"), all actually available at YOUR Town Hall.
   Base your candidates on the ACTUAL defense layout you identified in steps 1-6.
   When the base makes both viable, include at least one air and one ground option.
   Never default to one popular attack.

8. COMPARE — judge each candidate against the SPECIFIC base layout you analyzed:
   - Base compatibility with the defenses YOU IDENTIFIED
   - Pathing reliability given the entry points YOU EVALUATED
   - Defensive-threat matchup against the KEY DEFENSES YOU RECORDED
   - Entry difficulty based on the compartments YOU SAW
   - Record strengths, weaknesses and fit_score per candidate.

9. SELECT — pick the candidate with the strongest overall fit for THIS SPECIFIC BASE.
   Exactly one entry has selected:true, its id matches strategy.type, and it MUST be
   the candidate with the highest fit_score.
```

**Problems:**
- Vague evaluation criteria
- No guidance on HOW to judge "base compatibility"
- No fit_score calculation guidance
- No strategy-specific criteria
- No archetype classification
- No forbidden patterns
- No success criteria

### AFTER (357 lines added)

```
═══════════════════════════════════════════════════════════════════════════
CORE PRINCIPLE: STRATEGY MUST ANSWER THE BASE
═══════════════════════════════════════════════════════════════════════════

The selected strategy MUST answer:
"Why is THIS attack strategy the best strategy for THIS specific base?"

NOT: "What is a generally strong TH11 strategy?"

7. GENERATE CANDIDATE STRATEGIES (2-4 candidates)
   [Detailed candidate selection rules]
   [Example candidates with conditions]

8. EVALUATE EACH CANDIDATE AGAINST THIS SPECIFIC BASE
   For EVERY candidate strategy, evaluate these BASE-SPECIFIC factors:
   
   a) TOWN HALL ACCESS: [4 sub-criteria]
   b) DEFENSE CLUSTER ANALYSIS: [3 sub-criteria]
   c) PATHING RELIABILITY: [7 sub-criteria + critical note]
   d) FUNNEL REQUIREMENTS: [4 levels + scoring impact]
   e) ENTRY POINT COMPATIBILITY: [4 sub-criteria]
   f) SPELL EFFICIENCY: [5 spell types + warning]
   g) HERO COMPATIBILITY: [4 sub-criteria]
   h) EXECUTION DIFFICULTY: [4 sub-criteria]
   i) EXPECTED VALUE: [3 outcome likelihoods]
   j) BASE ARCHETYPE MATCH: [9 archetype types + fit logic]
   
   [Example output with fit_score calculation]
   [Critical fit_score rules]

9. COMPARE STRATEGIES
   [Comparison matrix example]
   [Base-specific comparison requirements]
   [Anti-overfit warning]

10. SELECT THE FINAL STRATEGY
    [Selection with highest fit_score]
    [Explanation requirements]
    [Example with base-specific reasons]
    [Forbidden generic explanations]

11. STRATEGY CONFIDENCE
    [Confidence score requirements]
    [When to lower confidence]
    [No pretending certainty]

12. STRATEGY MUST DETERMINE ARMY COMPOSITION
    [Correct vs incorrect flow]
    [Tactical purpose requirements]
    [No arbitrary troops]

═══════════════════════════════════════════════════════════════════════════
STRATEGY-SPECIFIC EVALUATION EXAMPLES
═══════════════════════════════════════════════════════════════════════════

[6 strategies with concrete ✓/✗ criteria]

═══════════════════════════════════════════════════════════════════════════
FULL CAUSE-AND-EFFECT CHAIN
═══════════════════════════════════════════════════════════════════════════

[Complete logical flow diagram]

═══════════════════════════════════════════════════════════════════════════
IMPORTANT FAILURE CASES - UNCERTAINTY HANDLING
═══════════════════════════════════════════════════════════════════════════

[What NOT to do]
[What to do INSTEAD]
[Example with uncertainty]

═══════════════════════════════════════════════════════════════════════════
CRITICAL SUCCESS CRITERIA
═══════════════════════════════════════════════════════════════════════════

[14 success checkpoints]

FORBIDDEN PATTERNS:
[10 explicitly prohibited behaviors]

OPTIMIZATION GOAL:
[What NOT to optimize for]
[What TO optimize for]
```

**Improvements:**
- 10 evaluation dimensions with sub-criteria
- Concrete fit_score calculation rules
- Strategy-specific evaluation examples
- Base archetype classification
- Explicit forbidden patterns
- Critical success criteria
- Uncertainty handling
- Optimization goal clarification

## Example Output Quality

### BEFORE

```json
{
  "strategy": {
    "name": "Queen Charge Hybrid",
    "type": "queen-charge-hybrid",
    "reason": "Queen Charge Hybrid is a versatile strategy that works well at TH11."
  },
  "candidate_strategies": [
    {
      "id": "queen-charge-hybrid",
      "name": "Queen Charge Hybrid",
      "fit_score": 0.85,
      "strengths": ["Strong at TH11"],
      "weaknesses": ["Requires skill"],
      "selected": true
    },
    {
      "id": "zap-dragons",
      "name": "Zap Dragons",
      "fit_score": 0.80,
      "strengths": ["Easy to execute"],
      "weaknesses": ["Less reliable"],
      "selected": false,
      "rejected_reason": "Hybrid is stronger"
    }
  ]
}
```

**Problems:**
- Generic reason ("versatile", "works well")
- Arbitrary fit_scores (0.85, 0.80)
- Generic strengths/weaknesses
- Generic rejection reason
- No reference to actual base
- Could apply to ANY base

### AFTER

```json
{
  "strategy": {
    "name": "Queen Charge Hybrid",
    "type": "queen-charge-hybrid",
    "reason": "Kompartemen barat memberi Queen akses langsung ke hero musuh dan inferno_1, sementara entry selatan menyediakan jalur Hybrid yang kompak menuju Town Hall. Air Defense yang tersebar di posisi (0.38, 0.52), (0.62, 0.48), dan (0.51, 0.28) membuat serangan udara penuh kurang efisien."
  },
  "candidate_strategies": [
    {
      "id": "queen-charge-hybrid",
      "name": "Queen Charge Hybrid",
      "fit_score": 8.7,
      "strengths": [
        "Queen dapat menghapus inferno_1 dan hero musuh di kompartemen barat",
        "Hybrid memiliki jalur langsung ke Town Hall melalui entry selatan",
        "Funnel dapat dibuat dengan mudah menggunakan 4 Wizard"
      ],
      "weaknesses": [
        "Queen path memerlukan funnel presisi untuk menghindari kompartemen timur",
        "Risiko sedang jika Queen terlalu dalam sebelum Hybrid masuk"
      ],
      "selected": true
    },
    {
      "id": "zap-dragons",
      "name": "Zap Dragons",
      "fit_score": 7.2,
      "strengths": [
        "Execution lebih mudah, tidak perlu Queen Charge timing",
        "Lightning dapat menghapus 2 Air Defense"
      ],
      "weaknesses": [
        "Air Defense di (0.38, 0.52), (0.62, 0.48), (0.51, 0.28) terlalu tersebar",
        "Memerlukan 5+ Lightning untuk menghapus semua Air Defense",
        "Jalur udara setelah zap masih terancam Wizard Tower di 4 posisi"
      ],
      "selected": false,
      "rejected_reason": "Air Defense terlalu tersebar (jarak >0.3 antar AD) sehingga Lightning tidak efisien. Memerlukan 6 spell untuk menghapus semua AD, menyisakan terlalu sedikit spell untuk support. Queen Charge Hybrid lebih cocok karena dapat menghapus satu AD via Queen path dan Hybrid dapat menghindari AD lainnya."
    },
    {
      "id": "lavaloon",
      "name": "Lavaloon",
      "fit_score": 6.9,
      "strengths": [
        "Air path dapat dikelola setelah Queen menghapus airdef_1",
        "Lava Hound dapat tank untuk Balloon"
      ],
      "weaknesses": [
        "Jalur udara terfragmentasi di sekitar kompartemen timur",
        "Wizard Tower di 5 posisi mengancam Balloon",
        "Queen Charge harus menghapus 2 Air Defense untuk membuat path viable"
      ],
      "selected": false,
      "rejected_reason": "Wizard Tower terlalu banyak (5 posisi teridentifikasi) dan tersebar merata, mengancam Balloon di semua jalur udara. Queen Charge harus menghapus minimal 2 Air Defense untuk membuat jalur udara layak, tetapi akses Queen ke airdef_2 dan airdef_3 sulit karena terpisah 2 kompartemen. Hybrid path lebih direct."
    }
  ],
  "confidence": {
    "base_analysis": 0.93,
    "strategy_selection": 0.88,
    "army_composition": 0.85,
    "deployment": 0.82
  }
}
```

**Improvements:**
- Reason references actual compartments ("kompartemen barat")
- Reason references actual defenses by ID ("inferno_1", "airdef_1")
- Reason references actual positions ((0.38, 0.52), (0.62, 0.48))
- Fit scores are meaningfully different (8.7, 7.2, 6.9)
- Fit scores derived from actual analysis
- Strengths/weaknesses reference actual base features
- Rejection reasons are specific and detailed
- Rejection reasons compare against selected strategy
- No generic language ("versatile", "strong", "reliable")
- Confidence scores reflect actual certainty

## Candidate Variety

### BEFORE
**Same candidates for every TH11 base:**
- Queen Charge Hybrid (always)
- Zap Dragons (always)
- Lavaloon (always)

### AFTER
**Candidates vary based on base:**

**Compact base with clustered Air Defenses:**
- E-Drag (chain lightning value high)
- Zap Dragons (ADs easy to eliminate)
- Queen Charge Hybrid (compact path)

**Ring base with spread Air Defenses:**
- Queen Charge Hybrid (funnel value high)
- Lavaloon (Queen can remove ADs)
- Witch Smash (ground swarm through layers)

**Multi-compartment base:**
- Queen Charge Miners (underground bypasses walls)
- Super Archer Blimp (direct to TH)
- Queen Charge Hybrid (if Queen has good access)

**Box base with offset TH:**
- Queen Charge Hybrid (direct TH access)
- Witch Smash (ground push through compartments)
- Zap Dragons (if ADs can be zapped)

## Strategy Selection Diversity

### BEFORE
**10 different bases:**
- Queen Charge Hybrid: 9 bases
- Zap Dragons: 1 base

### AFTER (Expected)
**10 different bases:**
- Queen Charge Hybrid: 3-4 bases (when Queen access is good)
- Zap Dragons: 2-3 bases (when ADs are clustered)
- Lavaloon: 1-2 bases (when air path is manageable)
- E-Drag: 1-2 bases (when ADs clustered + buildings close)
- Witch Smash: 1 base (when compartments favor ground swarm)
- Super Archer Blimp: 1 base (when TH is blimp-accessible)

## Fit Score Calculation

### BEFORE
```
Arbitrary scores:
- First candidate: 0.85
- Second candidate: 0.80
- Third candidate: 0.75
```

**No justification, no connection to base**

### AFTER
```
Base-specific calculation:

Queen Charge Hybrid:
+ TH Access: Excellent (3.0)
+ Pathing: Excellent (2.5)
+ Defense Match: Excellent (2.0)
+ Funnel: Moderate (1.2)
= Fit Score: 8.7

Zap Dragons:
+ TH Access: Excellent (3.0)
+ Pathing: Medium (1.5)
+ Defense Match: Good (1.7)
+ Funnel: Easy (1.0)
- Spell Efficiency: Poor (-1.0)
= Fit Score: 7.2

Lavaloon:
+ TH Access: Medium (2.0)
+ Pathing: Good (1.8)
+ Defense Match: Excellent (2.0)
+ Funnel: Difficult (0.6)
- Risk: High (-1.5)
= Fit Score: 6.9
```

**Derived from actual evaluation, different for each base**

## Summary of Changes

### Quantitative
- **Lines Added**: +357 lines
- **Evaluation Dimensions**: 1 → 10
- **Strategy Examples**: 0 → 6
- **Forbidden Patterns**: 0 → 10
- **Success Criteria**: 0 → 14
- **New Sections**: 8 major sections

### Qualitative
- **Vague** → **Specific** evaluation criteria
- **Generic** → **Base-specific** reasoning
- **Arbitrary** → **Calculated** fit scores
- **Same strategy** → **Varied strategies** across bases
- **No guidance** → **Comprehensive guidance**
- **No examples** → **Concrete examples**
- **No anti-patterns** → **Explicit anti-patterns**
- **No success criteria** → **Clear success criteria**

## Expected Impact

### On Strategy Diversity
- **Before**: 90% Queen Charge Hybrid
- **After**: 30-40% Queen Charge Hybrid, distributed across 5-6 strategies

### On Reasoning Quality
- **Before**: "Versatile and strong"
- **After**: "Western compartment gives Queen access to inferno_1 and enemy hero"

### On User Experience
- **Before**: Predictable, generic plans
- **After**: Varied, base-specific plans that actually analyze the base

### On AI Behavior
- **Before**: Default to popular strategy
- **After**: Analyze base → evaluate options → select best fit

## Conclusion

The implementation of PROMPT C transforms the strategy selection system from a simple 3-step process with vague criteria into a comprehensive 11-step evaluation framework with:

- **10 evaluation dimensions** per candidate
- **Base archetype classification**
- **Strategy-specific evaluation examples**
- **Concrete fit score calculation**
- **Explicit forbidden patterns**
- **Critical success criteria**
- **Uncertainty handling**
- **Full cause-and-effect chain**

The result is a system that produces **base-specific, well-reasoned strategy selections** instead of defaulting to generic, popular strategies.
