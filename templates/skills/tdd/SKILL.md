---
name: tdd
description: Test-Driven Development workflow guidance. Triggers on tdd, test-driven, red-green-refactor, unit test.
---

# Test-Driven Development (TDD) Skill

This skill guides you through the TDD workflow.

## When to Use

- Starting a new feature or function
- Fixing a bug (write a failing test first)
- Refactoring existing code
- When user explicitly asks for TDD approach

## The Red-Green-Refactor Cycle

1. **RED**: Write a failing test that defines the expected behavior
2. **GREEN**: Write the minimum code to make the test pass
3. **REFACTOR**: Clean up the code while keeping tests green

## Best Practices

- Write one test at a time
- Keep tests small and focused
- Test behavior, not implementation
- Use descriptive test names
- Run tests frequently

## Anti-Patterns to Avoid

- Writing tests after the code
- Testing implementation details
- Skipping the refactor step
- Writing too many tests at once

## Example Workflow

```
User: "Add a function to calculate tax"

1. First, write a test:
   test('calculateTax returns 10% of amount', () => {
     expect(calculateTax(100)).toBe(10);
   });

2. Run test â†’ RED (fails)

3. Write minimal code:
   function calculateTax(amount) {
     return amount * 0.1;
   }

4. Run test â†’ GREEN (passes)

5. Refactor if needed
```
