import "just-styled/runtime/patch";
import { createStyledElement as _createStyledElement } from "just-styled/runtime";
import styled from 'styled-components';
type Props = {
  color: string;
  size: number;
};

// Typed interpolation param: the `Props` type reference must not be mistaken
// for a value reference (it has no value binding under syntax-only TS parsing).
const Typed = /*#__PURE__*/_createStyledElement({
  component: "p",
  className: "js-5gdybc",
  css: ".js-5gdybc{color:var(--sc-1rckq5y-0-0);}",
  vars: [["--sc-1rckq5y-0-0", (props: Props) => props.color]],
  displayName: "code__Typed",
  componentId: "sc-1rckq5y-0",
  fallback: () => styled.p.withConfig({
    displayName: "code__Typed",
    componentId: "sc-1rckq5y-0"
  })(["color:", ";"], (props: Props) => props.color)
});

// Generic tag type argument (styled.p<Props>) — type args live on the tagged
// template, not the tag, so the component is still eligible.
const Generic = /*#__PURE__*/_createStyledElement({
  component: "p",
  className: "js-1xksrxe",
  css: ".js-1xksrxe{color:var(--sc-1rckq5y-1-0);}",
  vars: [["--sc-1rckq5y-1-0", (props: Props) => props.color]],
  displayName: "code__Generic",
  componentId: "sc-1rckq5y-1",
  fallback: () => styled.p.withConfig({
    displayName: "code__Generic",
    componentId: "sc-1rckq5y-1"
  })(["color:", ";"], (props: Props) => props.color)
});

// Destructured typed param reads only its own binding -> still eligible.
const Destructured = /*#__PURE__*/_createStyledElement({
  component: "p",
  className: "js-bsd5jl",
  css: ".js-bsd5jl{color:var(--sc-1rckq5y-2-0);}",
  vars: [["--sc-1rckq5y-2-0", ({
    color
  }: Props) => color]],
  displayName: "code__Destructured",
  componentId: "sc-1rckq5y-2",
  fallback: () => styled.p.withConfig({
    displayName: "code__Destructured",
    componentId: "sc-1rckq5y-2"
  })(["color:", ";"], ({
    color
  }: Props) => color)
});

// Theme access is still ineligible even when the param is typed.
const Themed = styled.p.withConfig({
  displayName: "code__Themed",
  componentId: "sc-1rckq5y-3"
})(["color:", ";"], (props: {
  theme: {
    fg: string;
  };
}) => props.theme.fg);
