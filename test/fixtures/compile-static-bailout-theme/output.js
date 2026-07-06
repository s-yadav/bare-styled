import styled from 'styled-components';
const Themed = styled.div.withConfig({
  displayName: "code__Themed",
  componentId: "sc-1l482jj-0"
})(["color:", ";"], props => props.theme.main);
const DestructuredTheme = styled.div.withConfig({
  displayName: "code__DestructuredTheme",
  componentId: "sc-1l482jj-1"
})(["background:", ";"], ({
  theme
}) => theme.bg);
