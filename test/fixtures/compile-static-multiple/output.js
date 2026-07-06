import "just-styled/runtime/patch";
import { createStyledElement as _createStyledElement } from "just-styled/runtime";
import styled from 'styled-components';
const First = /*#__PURE__*/_createStyledElement({
  component: "h1",
  className: "js-1rq7cxa",
  css: ".js-1rq7cxa{font-weight:700;}",
  displayName: "code__First",
  componentId: "sc-1duujgi-0",
  fallback: () => styled.h1.withConfig({
    displayName: "code__First",
    componentId: "sc-1duujgi-0"
  })(["font-weight:700;"])
});
const Second = /*#__PURE__*/_createStyledElement({
  component: "h2",
  className: "js-q1grnm",
  css: ".js-q1grnm{font-weight:var(--sc-1duujgi-1-0);}",
  vars: [["--sc-1duujgi-1-0", props => props.weight]],
  displayName: "code__Second",
  componentId: "sc-1duujgi-1",
  fallback: () => styled.h2.withConfig({
    displayName: "code__Second",
    componentId: "sc-1duujgi-1"
  })(["font-weight:", ";"], props => props.weight)
});
const Bail = styled.h3.withConfig({
  displayName: "code__Bail",
  componentId: "sc-1duujgi-2"
})(["color:", ";"], props => props.theme.accent);
const Third = /*#__PURE__*/_createStyledElement({
  component: "h4",
  className: "js-1n4qdik",
  css: ".js-1n4qdik{margin:0;}",
  displayName: "code__Third",
  componentId: "sc-1duujgi-3",
  fallback: () => styled.h4.withConfig({
    displayName: "code__Third",
    componentId: "sc-1duujgi-3"
  })(["margin:0;"])
});
