2026-05-05 | 12:33:52
# AGENT MEMORY

## Consolidated Summary

## USER PREFERENCES
-

## ARCHITECTURE DECISIONS
- Global development guidelines and mandatory project standards: Never use emojis in code, documentation, or system outputs.
- Always design functional, organized, and scalable architectures.
- Preference for JavaScript-based development (Node.js, frontend, or fullstack).
- Always prioritize production-level security in all decisions.
- Never expose sensitive variables in code (tokens, passwords, keys, etc.).
- Never use mocked or fake variables in production code.
- Always use .env files properly and ensure they are included in .gitignore.
- Maintain a professional and complete .gitignore file.
- Always create a well-structured and complete README.md for every project.
- Ensure full UTF-8 compatibility across all files and systems.
- Always use proper text encoding and correct language formatting in documentation.
- Prefer Object-Oriented Programming (OOP) for code organization.
- Always create JSON configuration files for editable system variables.
- Structure configuration files clearly to simplify maintenance and updates.

## CONSTRAINTS
- Maintain flexibility to use other technology stacks when appropriate without compromising the standards defined in Context 1.
- Choose technologies based on problem fit, performance requirements, and scalability, not personal bias.
- Use third-party libraries responsibly, avoiding unnecessary dependencies.
- Prefer native implementations when feasible to reduce bloat and increase control.
- Always evaluate library size, maintenance status, community support, and security before adoption.
- Avoid overengineering and excessive abstraction layers that harm performance.
- Focus on performance optimization from the design phase, not as an afterthought.
- Optimize for low latency, efficient memory usage, and scalable execution.
- Design systems with clear modularization and separation of concerns.
- Ensure each module has a single, well-defined responsibility.
- Enforce a maximum file size of 600 lines of code.
- Break large files into smaller, reusable modules when approaching the limit.
- Structure projects to allow easy navigation, testing, and maintainability.
- Favor clean interfaces between modules to reduce coupling.

## PATTERNS
- Base template for new projects.
- Code review reference.
- Standardization across teams and AI agents.
- Validation rules for CI/CD pipelines.

## IMPORTANT CONTEXTS
- **memory_voult/context/context_1.md**: Contains global development guidelines and mandatory project standards, ensuring standardization, security, scalability, and maintainability. These guidelines reduce production risks and improve collaboration and long-term system evolution.
- **memory_voult/context/context_2.md**: Describes technology stack flexibility, responsible library usage, and performance-oriented modular architecture. It ensures systems remain efficient, maintainable, and scalable while avoiding technical debt, unnecessary complexity, and performance bottlenecks.

## NOTES
-
MANDATORY QUALITY CHECK BEFORE FINAL OUTPUT:
- Ensure every section has at least one non-empty bullet.
- Use "- No explicit information found in current context files." ONLY when that specific section truly has no relevant facts after reading all context files.
- Never leave template placeholders in the final output.

## Processed Context Files
- memory_voult/context/context_1.md
- memory_voult/context/context_2.md
