import "just-styled/runtime/patch";
import { createStyledElement as _createStyledElement } from "just-styled/runtime";
import styled from 'styled-components';
const Card = /*#__PURE__*/_createStyledElement({
  component: "section",
  className: "js-6k2beq",
  css: ".js-6k2beq{padding:16px;border:1px solid #eee;width:var(--sc-1flogde-0-1);}",
  vars: [["--sc-1flogde-0-1", props => props.width]],
  displayName: "code__Card",
  componentId: "sc-1flogde-0",
  fallback: () => styled.section.withConfig({
    displayName: "code__Card",
    componentId: "sc-1flogde-0"
  })(["padding:", "px;border:1px solid #eee;width:", ";"], 8 * 2, props => props.width)
});
