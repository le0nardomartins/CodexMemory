# Memory Context 2

## Summary
Technology stack flexibility, responsible library usage, and performance-oriented modular architecture

## Details
- Maintain flexibility to use other technology stacks when appropriate (e.g., Python, C++, Go), without compromising the standards defined in Context 1
- Choose technologies based on problem fit, performance requirements, and scalability, not personal bias
- Use third-party libraries responsibly, avoiding unnecessary dependencies
- Prefer native implementations when feasible to reduce bloat and increase control
- Always evaluate library size, maintenance status, community support, and security before adoption
- Avoid overengineering and excessive abstraction layers that harm performance
- Focus on performance optimization from the design phase, not as an afterthought
- Optimize for low latency, efficient memory usage, and scalable execution
- Design systems with clear modularization and separation of concerns
- Ensure that each module has a single, well-defined responsibility
- Enforce a maximum file size of 600 lines of code
- Break large files into smaller, reusable modules when approaching the limit
- Structure projects to allow easy navigation, testing, and maintainability
- Favor clean interfaces between modules to reduce coupling
- Ensure consistency with OOP principles and configuration patterns defined in Context 1

## Why it matters
This ensures that systems remain efficient, maintainable, and scalable while avoiding technical debt, unnecessary complexity, and performance bottlenecks

## Possible future usage
- Architecture decision guidelines
- Codebase refactoring standards
- Performance review checklist
- Dependency management policies