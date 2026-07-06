import "just-styled/runtime/patch";
import { createStyledElement as _createStyledElement } from "just-styled/runtime";
import styled from 'styled-components';
const Badge = /*#__PURE__*/_createStyledElement({
  component: "span",
  className: "js-dnwyj6",
  css: ".js-dnwyj6{color:var(--sc-1fze9mx-0-0);}",
  vars: [["--sc-1fze9mx-0-0", props => props.color]],
  displayName: "code__Badge",
  componentId: "sc-1fze9mx-0",
  fallback: () => styled.span.withConfig({
    displayName: "code__Badge",
    componentId: "sc-1fze9mx-0"
  })`color:${props => props.color};`
});
const Bail = styled.div.withConfig({
  displayName: "code__Bail",
  componentId: "sc-1fze9mx-1"
})`${props => props.mixin};`;
