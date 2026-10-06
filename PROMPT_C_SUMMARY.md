# PROMPT C: BASE-SPECIFIC STRATEGY SELECTION - IMPLEMENTATION SUMMARY

## Overview

Successfully implemented comprehensive base-specific strategy selection logic for the CoC Planner AI system as specified in PROMPT C requirements.

## Core Problem Addressed

**Before**: The AI was defaulting to the same attack strategy for every base, producing generic explanations like "Queen Charge Hybrid is versatile and strong."

**After**: The AI must analyze the actual base first, generate multiple candidates, evaluate each against THIS specific base, and select the strategy with the strongest fit based on measurable base characteristics.

## Implementation Metrics

- **File Modified**: `/home/ubuntu/coc-planner/src/lib/attack/ai.ts`
- **Lines Added**: +357 lines (769 → 1,126 lines)
- **New Sections**: 8 major sections added
- **Evaluation Dimensions**: 10 per candidate strategy
- **Strategy Examples**: 6 strategies with concrete evaluation criteria

## Key Enhancements

### 1. Core Principle Statement
```
The selected strategy MUST answer:
"Why is THIS attack strategy the best strategy for THIS specific base?"

NOT: "What is a generally strong TH11 strategy?"
```

### 2. Comprehensive Candidate Evaluation (10 Dimensions)
1. Town Hall Access (easiest/safest/fastest)
2. Defense Cluster Analysis
3. Pathing Reliability (split risk, wall crossing)
4. Funnel Requirements (easy/moderate/difficult/impractical)
5. Entry Point Compatibility
6. Spell Efficiency
7. Hero Compatibility
8. Execution Difficulty
9. Expected Value (3-star/2-star likelihood)
10. Base Archetype Match (compact/ring/box/spread/etc.)

### 3. Base Archetype Classification

Added classification guidance:
- Compact core → concentrated attacks
- Ring base → funnel strategies
- Box base → wall-breaking or flying strategies
- Spread base → wide attacks or surgical strikes
- Anti-2-star → dedicated TH kill required
- Anti-3-star → systematic approach required
- Centralized TH → harder to reach but predictable
- Offset TH → easier to reach, requires path adjustment
- Multi-compartment → air may be better (ground splits)

### 4. Strategy-Specific Evaluation Examples

Provided concrete criteria for 6 major strategies:

**Queen Charge Hybrid:**
- ✓ Strong: Queen can reach high-value defenses
- ✓ Strong: Hybrid has compact path to TH
- ✗ Weak: Queen has poor defense access
- ✗ Weak: Hybrid splits across compartments

**Zap Dragons:**
- ✓ Strong: Air Defenses removed with 3-4 Lightning
- ✗ Weak: Air Defenses spread requiring 5+ spells

**Lavaloon:**
- ✓ Strong: Queen can remove 1-2 Air Defenses
- ✗ Weak: Air path fragmented

**Super Archer Blimp:**
- ✓ Strong: TH accessible via direct blimp path
- ✗ Weak: Blimp path heavily defended

**Witch Smash:**
- ✓ Strong: Compartments favor ground swarm
- ✗ Weak: Multi-compartment splits Witches

**E-Drag:**
- ✓ Strong: Buildings clustered for chain lightning
- ✗ Weak: Buildings spread too far

### 5. Fit Score Requirements

**CRITICAL RULES:**
- Scores MUST be base-specific
- DO NOT use arbitrary scores (0.85, 0.80, 0.75...)
- Different candidates MUST have meaningfully different scores
- Range: 0.0 (unsuitable) to 10.0 (perfect fit)
- Poor pathing → LOWER score
- Difficult funnel → LOWER score
- Inefficient spells → LOWER score

### 6. Strategy Selection Explanation

**REQUIRED**: References to actual base characteristics
- Specific compartments ("western compartment")
- Specific defenses ("Eagle Artillery", "inferno_1")
- Specific positions ("centralized Town Hall")
- Specific entry points ("southern entry")

**FORBIDDEN**: Generic explanations
- ❌ "Queen Charge Hybrid is versatile"
- ❌ "This strategy works well at TH11"
- ❌ "Hybrid is a reliable strategy"
- ❌ Any explanation that could apply to ANY base

### 7. Full Cause-and-Effect Chain

```
BASE STRUCTURE → THREAT → OPPORTUNITY → STRATEGY → 
FUNNEL → ENTRY → TROOP DEPLOYMENT → MOVEMENT PATH → 
TARGET → SPELL/ABILITY → NEXT PHASE → END OBJECTIVE
```

Every action has a reason. Every step enables the next.

### 8. Army Composition Logic

**CORRECT**: BASE → STRATEGY → ARMY → DEPLOYMENT → PATH
**INCORRECT**: ARMY → pick strategy name

Every troop group must have tactical purpose:
- "15 Miners: Main underground attack toward core"
- "12 Hog Riders: Main ground pressure with Hybrid"
- "4 Wizards: Create funnel on both sides"

### 9. Uncertainty Handling

**When base is difficult to analyze:**
- DO NOT invent buildings/positions/traps
- DO NOT pretend certainty
- DO lower confidence scores
- DO identify uncertainty in layoutNotes
- DO choose safer strategy
- DO explain uncertainty

### 10. Critical Success Criteria

**Response successful ONLY when:**
- ✓ 2-4 candidate strategies considered
- ✓ Candidates evaluated against ACTUAL base
- ✓ Final strategy has highest fit_score
- ✓ Strategy references actual defenses by ID
- ✓ Different bases CAN produce different strategies
- ✓ All rejected strategies have specific reasons
- ✓ No hallucinated defenses

### 11. Forbidden Patterns

**Explicitly prohibited:**
- ❌ Always defaulting to Queen Charge Hybrid
- ❌ Same candidate list for every base
- ❌ Arbitrary fit scores without analysis
- ❌ Selecting strategy before analyzing base
- ❌ Generic paths not referencing buildings
- ❌ Same spell loadout regardless of base
- ❌ Fixed hero selections ignoring base

## Optimization Goal

**NOT**: "Generate a strategy quickly"

**YES**: "Understand the base → compare viable strategies → choose the strategy that best exploits THIS base → build the complete attack plan around that strategy."

**Output must be**: A COHERENT TACTICAL PLAN, not a troop composition with a strategy name attached.

## Expected Behavior Changes

### Strategy Diversity
- **Before**: Queen Charge Hybrid for 90% of bases
- **After**: Different strategies for different base types

### Reasoning Quality
- **Before**: "Queen Charge Hybrid is versatile and strong"
- **After**: "Kompartemen barat memberi Queen akses ke inferno_1 dan hero musuh, sementara entry selatan menyediakan jalur Hybrid kompak ke Town Hall"

### Candidate Variety
- **Before**: Same 3 candidates every time
- **After**: Candidates change based on Air Defense spread, compartment structure, Town Hall position

### Fit Scores
- **Before**: 0.85, 0.80, 0.75 (arbitrary)
- **After**: 8.7, 7.9, 7.5 (derived from actual base evaluation)

## Testing Strategy

### Base Types to Test
1. Compact core bases → expect concentrated attacks
2. Ring bases → expect funnel-heavy strategies
3. Spread bases → expect wide attacks
4. Clustered Air Defenses → expect air strategies
5. Spread Air Defenses → expect ground strategies
6. Offset Town Hall → expect different entry points
7. Centralized Town Hall → expect core-focused strategies

### Validation Checks
1. Do different bases produce different strategies?
2. Are candidate lists varying per base?
3. Are fit scores meaningfully different?
4. Do strategy reasons reference actual base features?
5. Are rejection reasons specific (not generic)?
6. Do confidence scores reflect uncertainty?

## Success Metrics

### Quantitative
- Strategy diversity: >50% different strategies across varied bases
- Candidate variety: >50% different candidate lists
- Fit score variance: σ > 0.5 between candidates

### Qualitative
- Strategy reasons reference actual defenses by ID
- Strategy reasons reference actual compartments
- Strategy reasons reference actual positions
- Rejection reasons are specific, not generic
- No "versatile"/"strong"/"reliable" explanations

## Technical Implementation

### Modified Function
```typescript
export function buildSystemPrompt(request: AttackRequest): string
```

### Changes
- Enhanced steps 7-11 (strategy selection pipeline)
- Added strategy-specific evaluation examples
- Added full cause-and-effect chain requirement
- Added uncertainty handling section
- Added critical success criteria
- Added forbidden patterns
- Added optimization goal clarification

### Prompt Structure
```
1-6.  Base Recognition (unchanged)
7.    Generate Candidate Strategies (enhanced)
8.    Evaluate Each Candidate (NEW - 10 dimensions)
9.    Compare Strategies (enhanced)
10.   Select Final Strategy (enhanced)
11.   Strategy Confidence (NEW)
12.   Army Composition (NEW - strategy determines army)
13-16. Heroes, Spells, Deployment, Pathing (enhanced)
17.   Full Cause-and-Effect Chain (NEW)
18.   Strategy-Specific Examples (NEW)
19.   Precise Movement & Pathing (existing, renumbered)
      Uncertainty Handling (NEW)
      Critical Success Criteria (NEW)
      Forbidden Patterns (NEW)
      Optimization Goal (NEW)
```

## Conclusion

PROMPT C has been fully implemented. The AI system now has comprehensive guidance to:

1. **Analyze base first** before selecting strategy
2. **Generate multiple candidates** based on base characteristics
3. **Evaluate candidates** across 10 dimensions
4. **Select best fit** with highest score
5. **Explain selection** with base-specific reasons
6. **Build coherent plan** where strategy determines everything

The system is now designed to prevent default-to-one-strategy behavior and ensure every strategy selection is justified by actual base characteristics, with explicit forbidden patterns and success criteria to guide the AI toward base-specific tactical planning.
