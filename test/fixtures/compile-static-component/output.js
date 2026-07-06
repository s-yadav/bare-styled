import "just-styled/runtime/patch";
import { createStyledElement as _createStyledElement } from "just-styled/runtime";
import styled from 'styled-components';
function Wrapper({
  children,
  className
}) {
  return <div id="last-native-element" className={className}>{children}</div>;
}
const StyledWrapper = /*#__PURE__*/_createStyledElement({
  component: Wrapper,
  className: "js-14aksg3",
  css: ".js-14aksg3{background-color:var(--sc-1hrbwpk-0-0);}",
  vars: [["--sc-1hrbwpk-0-0", props => props.color]],
  displayName: "code__StyledWrapper",
  componentId: "sc-1hrbwpk-0",
  fallback: () => styled(Wrapper).withConfig({
    displayName: "code__StyledWrapper",
    componentId: "sc-1hrbwpk-0"
  })(["background-color:", ";"], props => props.color)
});
const StaticWrapper = /*#__PURE__*/_createStyledElement({
  component: Wrapper,
  className: "js-160szf5",
  css: ".js-160szf5{color:red;}",
  displayName: "code__StaticWrapper",
  componentId: "sc-1hrbwpk-1",
  fallback: () => styled(Wrapper).withConfig({
    displayName: "code__StaticWrapper",
    componentId: "sc-1hrbwpk-1"
  })(["color:red;"])
});
