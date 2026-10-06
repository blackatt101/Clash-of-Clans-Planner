# PROMPT C IMPLEMENTATION PLAN

## Overview
Enhance the AI strategy selection system to ensure base-specific strategy choices by implementing comprehensive candidate evaluation, comparison, and selection logic.

## Current State
The system already has:
- Base recognition pipeline (steps 1-6)
- Candidate strategy generation (step 7)
- Basic comparison framework (step 8)
- Selection logic (step 9)
- Hero evaluation system
- Deployment and pathing

## What Needs Enhancement

### 1. Strategy Evaluation Framework
**Goal**: Each candidate strategy must be evaluated against the ACTUAL base characteristics.

**Implementation Areas**:
- Town Hall access scoring
- Defense cluster analysis
- Pathing reliability assessment
- Funnel requirement evaluation
- Entry point compatibility
- Spell efficiency evaluation
- Hero role assignment per strategy

### 2. Base Archetype Classification
**Goal**: Classify base structure to inform strategy selection.

**Categories**:
- Compact core
- Ring base
- Box base
- Spread base
- Anti-2-star
- Anti-3-star
- Centralized vs offset Town Hall
- Multi-compartment layouts

### 3. Strategy Comparison Matrix
**Goal**: Compare candidates using base-specific metrics.

**Metrics**:
- Base compatibility score
- Pathing reliability
- Defense threat matchup
- Entry difficulty
- Funnel complexity
- Spell value
- Execution risk
- Expected value

### 4. Selection Reasoning
**Goal**: Provide clear explanation for why one strategy beats the others.

**Requirements**:
- Winner must have highest fit_score
- Reason must reference actual base features
- Rejected strategies must explain why they lost
- No generic explanations allowed

### 5. Strategy-Specific Evaluation Rules

#### Queen Charge Hybrid
- ✓ Strong if Queen can reach high-value defenses
- ✓ Strong if Hybrid path is compact
- ✓ Strong if funnel can be created
- ✗ Weak if Queen has poor access
- ✗ Weak if Hybrid splits across compartments

#### Zap Dragons
- ✓ Strong if Air Defenses can be zapped efficiently
- ✓ Strong if remaining air path is compact
- ✗ Weak if Air Defenses are spread widely
- ✗ Weak if remaining defenses are distributed

#### Lavaloon
- ✓ Strong if Queen can remove key defenses
- ✓ Strong if remaining air defenses create manageable path
- ✗ Weak if pathing is fragmented
- ✗ Weak if air defenses are optimally spread

## Implementation Strategy

### Phase 1: Enhanced Prompt Engineering (Current Focus)
1. ✅ Add base archetype classification instructions
2. ✅ Add strategy-specific evaluation criteria
3. ✅ Add comparison matrix requirements
4. ✅ Add selection explanation requirements
5. ✅ Add anti-pattern warnings (prevent generic strategies)

### Phase 2: Validation Enhancement (Future)
1. Validate that candidate_strategies has 2-4 entries
2. Validate that fit_scores are different
3. Validate that selected strategy has highest score
4. Validate that rejected strategies have rejection reasons
5. Validate that strategy.reason references base features

### Phase 3: Testing (Future)
1. Test with compact bases → expect different strategies
2. Test with spread bases → expect different strategies
3. Test with air defense spread → expect air vs ground variation
4. Test with Town Hall positions → expect different entry points
5. Verify no default-to-one-strategy behavior

## Success Criteria

✅ System generates 2-4 candidate strategies per request
✅ Candidates vary based on base characteristics
✅ Fit scores are base-specific and meaningful
✅ Selected strategy has highest fit_score
✅ Strategy selection reasons reference actual base features
✅ Different bases produce different strategies
✅ Same base type produces consistent strategy
✅ No generic "X is versatile" explanations
✅ All rejected strategies have specific rejection reasons
✅ Hero selection follows strategy requirements
✅ Army composition matches selected strategy
✅ Deployment plan aligns with strategy

## Key Anti-Patterns to Prevent

❌ Always defaulting to Queen Charge Hybrid
❌ Generic reasons: "versatile", "strong", "reliable"
❌ Same candidate list for every base
❌ Arbitrary fit scores (0.85, 0.80, 0.75...)
❌ Selecting strategy before analyzing base
❌ Strategy name first, then inventing a path
❌ Generic paths that don't reference actual buildings
❌ Same spell loadout regardless of base
❌ Fixed hero selections ignoring base needs

## Files Modified
- `/home/ubuntu/coc-planner/src/lib/attack/ai.ts` - Enhanced buildSystemPrompt()

## Next Steps
1. ✅ Update ai.ts prompt with enhanced strategy selection logic
2. Test with multiple base types
3. Monitor for strategy diversity
4. Add validation rules if patterns emerge
5. Consider adding strategy-specific sub-prompts if needed
