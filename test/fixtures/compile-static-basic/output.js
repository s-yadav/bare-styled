import "just-styled/runtime/patch";
import { createStyledElement as _createStyledElement } from "just-styled/runtime";
import styled from 'styled-components';
const Button = /*#__PURE__*/_createStyledElement({
  component: "button",
  className: "js-8vg4tp",
  css: ".js-8vg4tp{color:blue;font-size:14px;border-radius:4px;}.js-8vg4tp:hover{color:navy;}@media (min-width:600px){.js-8vg4tp{padding:0 16px;}}",
  displayName: "code__Button",
  componentId: "sc-zrs9bc-0",
  fallback: () => styled.button.withConfig({
    displayName: "code__Button",
    componentId: "sc-zrs9bc-0"
  })(["color:blue;font-size:14px;border-radius:4px;&:hover{color:navy;}@media (min-width:600px){padding:0 16px;}"])
});
const Label = /*#__PURE__*/_createStyledElement({
  component: "span",
  className: "js-1f2n4nh",
  css: ".js-1f2n4nh{display:inline-block;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;}",
  displayName: "code__Label",
  componentId: "sc-zrs9bc-1",
  fallback: () => styled('span').withConfig({
    displayName: "code__Label",
    componentId: "sc-zrs9bc-1"
  })(["display:inline-block;user-select:none;"])
});
