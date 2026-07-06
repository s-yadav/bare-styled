import "just-styled/runtime/patch";
import { createStyledElement as _createStyledElement } from "just-styled/runtime";
import styled from 'styled-components';
const Text = /*#__PURE__*/_createStyledElement({
  component: "p",
  className: "js-1ctr3u4",
  css: ".js-1ctr3u4{color:var(--sc-somp03-0-0);font-size:var(--sc-somp03-0-1);}",
  vars: [["--sc-somp03-0-0", props => props.color], ["--sc-somp03-0-1", ({
    size
  }) => size]],
  displayName: "code__Text",
  componentId: "sc-somp03-0",
  fallback: () => styled.p.withConfig({
    displayName: "code__Text",
    componentId: "sc-somp03-0"
  })(["color:", ";font-size:", ";"], props => props.color, ({
    size
  }) => size)
});
const UnitSuffix = styled.p.withConfig({
  displayName: "code__UnitSuffix",
  componentId: "sc-somp03-1"
})(["font-size:", "px;"], ({
  size
}) => size);
