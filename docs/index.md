---
title: Flowdrom Documentation
layout: default
---

# Flowdrom Documentation

Welcome to the Flowdrom documentation site.

## Quick Links
- [User Guide](user-guide.md)

## About Flowdrom
**Flowdrom** is a web-based tool for creating transaction timing diagrams and sequence charts. It uses JSON-based definitions to generate visual diagrams that can be exported as SVG or PNG files.


### Access 
[inventiview.github.io/flowdrom](https://inventiview.github.io/flowdrom/)

The user guide will be at:
[flowdrom/user-guide](https://inventiview.github.io/flowdrom/docs/user-guide.html)


## Tips for Creating Effective Diagrams

1. **Start Simple**: Begin with basic request-response patterns and add complexity gradually
2. **Use Sub-lanes Wisely**: Use `component.lane` or `lane.component` for internal details without cluttering
3. **Medium Lanes for Infrastructure**: Use `_MEDIUM_` notation for buses, networks, or interconnects
4. **Fractional Timing**: Use decimal values (0.5, 1.25, 2.75) for precise timing relationships  
5. **Use Consistent Colors**: Establish a color scheme for different types of messages
6. **Group Related Lanes**: Use lane groups for complex systems
7. **Let Info Boxes Auto-Position**: Trust the collision detection - it will find clear space
8. **Include Legends**: Always provide legends for diagrams with multiple message types
9. **Realistic Timing**: Use fractional intervals to show actual relative durations
10. **State Visibility**: Show important state changes to clarify system behavior

## Common Use Cases

- **API Documentation**: Show request/response flows
- **System Architecture**: Illustrate component interactions  
- **Protocol Specifications**: Document message sequences
- **Debugging**: Visualize problem scenarios
- **Cache Coherency**: Show memory consistency protocols
- **Microservices**: Document inter-service communication
- **Error Handling**: Illustrate failure and recovery patterns

---

*For more advanced features and customization options, refer to the source code at [github.com/inventiview/flowdrom](https://github.com/inventiview/flowdrom).*