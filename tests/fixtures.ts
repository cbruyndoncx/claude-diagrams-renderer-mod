// Small diagrams of each format, shared by the renderer and pane tests.

export const CANVAS = JSON.stringify({
  nodes: [
    { id: 'g', type: 'group', x: -10, y: -10, width: 1000, height: 120, label: 'Zone' },
    { id: 't', type: 'text', x: 0, y: 0, width: 200, height: 80, color: '6', text: 'Hello <world>' },
    { id: 'f', type: 'file', x: 380, y: 0, width: 200, height: 80, file: 'a/b/Note.md' },
    { id: 'l', type: 'link', x: 760, y: 0, width: 200, height: 80, url: 'https://jsoncanvas.org' },
  ],
  edges: [
    { id: 'e1', fromNode: 't', toNode: 'f', fromSide: 'right', toSide: 'left', label: 'cites' },
    { id: 'e2', fromNode: 'f', toNode: 'l' },
  ],
})

export function excalidrawNote(elements: unknown[], files = ''): string {
  return [
    '---', 'excalidraw-plugin: parsed', 'tags: [excalidraw]', '---', '',
    '# Excalidraw Data', '', '## Text Elements', 'Start ^a1', '',
    ...(files ? ['## Embedded Files', files, ''] : []),
    '%%', '## Drawing', '```json',
    JSON.stringify({ type: 'excalidraw', version: 2, elements, appState: { viewBackgroundColor: '#ffffff' } }),
    '```', '%%', '',
  ].join('\n')
}

export const EXCALIDRAW_ELEMENTS = [
  { id: 'lane', type: 'rectangle', x: 0, y: 0, width: 1000, height: 80, backgroundColor: '#e7f5ff', fillStyle: 'solid' },
  { id: 'r', type: 'rectangle', x: 20, y: 10, width: 160, height: 60, backgroundColor: '#b2f2bb', fillStyle: 'solid', strokeColor: '#1e1e1e', roundness: { type: 3 } },
  { id: 't', type: 'text', x: 30, y: 30, width: 140, height: 25, text: 'Start <here>', fontSize: 20, textAlign: 'center', strokeColor: '#1e1e1e' },
  { id: 'e', type: 'ellipse', x: 400, y: 10, width: 100, height: 60, strokeColor: '#1971c2' },
  { id: 'd', type: 'diamond', x: 800, y: 0, width: 80, height: 80, strokeColor: '#e03131' },
  { id: 'a', type: 'arrow', x: 180, y: 40, width: 220, height: 0, points: [[0, 0], [220, 0]], endArrowhead: 'arrow', strokeColor: '#1e1e1e' },
  { id: 'f', type: 'freedraw', x: 0, y: 100, width: 50, height: 20, points: [[0, 0], [25, 20], [50, 0]] },
  { id: 'x', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: true },
]
export const EXCALIDRAW = excalidrawNote(EXCALIDRAW_ELEMENTS)

const dpage = (name: string, id: string, cells: string, background = '') =>
  `<diagram name="${name}" id="${id}"><mxGraphModel${background}><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram>`

export const DRAWIO =
  '<mxfile host="Electron">' +
  dpage('Overview', 'p1',
    '<mxCell id="a" value="&lt;b&gt;Start&lt;/b&gt;&lt;br&gt;here" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="60" as="geometry"/></mxCell>' +
    '<mxCell id="b" value="Decide" style="rhombus;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="200" y="0" width="80" height="80" as="geometry"/></mxCell>' +
    '<mxCell id="c" value="End" style="ellipse;" vertex="1" parent="1"><mxGeometry x="360" y="10" width="80" height="40" as="geometry"/></mxCell>' +
    '<mxCell id="e1" value="yes" style="endArrow=classic;dashed=1;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>' +
    '<mxCell id="e2" style="endArrow=classic;" edge="1" parent="1" source="b" target="c"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="320" y="40"/></Array></mxGeometry></mxCell>' +
    '<mxCell id="g" value="Group" style="swimlane;startSize=20;" vertex="1" parent="1"><mxGeometry x="0" y="120" width="440" height="100" as="geometry"/></mxCell>' +
    '<mxCell id="inner" value="Inside" style="rounded=0;" vertex="1" parent="g"><mxGeometry x="20" y="40" width="80" height="30" as="geometry"/></mxCell>' +
    '<object label="Wrapped label" id="w"><mxCell style="text;html=1;" vertex="1" parent="1"><mxGeometry x="260" y="140" width="120" height="20" as="geometry"/></mxCell></object>') +
  dpage('Details', 'p2',
    '<mxCell id="d" value="Detail page" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="140" height="40" as="geometry"/></mxCell>',
    ' background="#1a1a2e"') +
  '</mxfile>'

const shape = (el: string, x: number, y: number, w: number, h: number, extra = '') =>
  `<bpmndi:BPMNShape id="${el}_di" bpmnElement="${el}"${extra}><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}"/></bpmndi:BPMNShape>`
const edge = (el: string, pts: [number, number][]) =>
  `<bpmndi:BPMNEdge id="${el}_di" bpmnElement="${el}">${pts.map(([x, y]) => `<di:waypoint x="${x}" y="${y}"/>`).join('')}</bpmndi:BPMNEdge>`

export const BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" id="D">
  <bpmn:collaboration id="C"><bpmn:participant id="P" name="Orders &amp; Billing" processRef="Proc"/></bpmn:collaboration>
  <bpmn:process id="Proc">
    <bpmn:laneSet><bpmn:lane id="L1" name="Sales"/><bpmn:lane id="L2" name="Finance"/></bpmn:laneSet>
    <bpmn:startEvent id="S" name="Order in"/>
    <bpmn:userTask id="T1" name="Capture &lt;order&gt;"/>
    <bpmn:serviceTask id="T2" name="Credit check"/>
    <bpmn:boundaryEvent id="B" name="SLA PT4H" attachedToRef="T2" cancelActivity="false"><bpmn:timerEventDefinition/></bpmn:boundaryEvent>
    <bpmn:exclusiveGateway id="G" name="Approved?" default="F4"/>
    <bpmn:task id="T3" name="Slow manual rework"/>
    <bpmn:endEvent id="E" name="Done"/>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T1"/>
    <bpmn:sequenceFlow id="F2" sourceRef="T1" targetRef="T2"/>
    <bpmn:sequenceFlow id="F3" sourceRef="T2" targetRef="G"/>
    <bpmn:sequenceFlow id="F4" name="yes" sourceRef="G" targetRef="E"/>
    <bpmn:sequenceFlow id="F5" name="no" sourceRef="G" targetRef="T3"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag1" name="Main"><bpmndi:BPMNPlane id="Plane1" bpmnElement="C">
    ${shape('P', 0, 0, 800, 300, ' isHorizontal="true"')}
    ${shape('L1', 30, 0, 770, 150, ' isHorizontal="true"')}
    ${shape('L2', 30, 150, 770, 150, ' isHorizontal="true"')}
    ${shape('S', 80, 57, 36, 36)}
    ${shape('T1', 160, 35, 100, 80)}
    ${shape('T2', 160, 185, 100, 80)}
    ${shape('B', 222, 247, 36, 36)}
    ${shape('G', 320, 200, 50, 50, ' isMarkerVisible="true"')}
    ${shape('T3', 420, 185, 100, 80, ' bioc:stroke="#c62828" bioc:fill="#ffebee"')}
    ${shape('E', 600, 57, 36, 36)}
    ${edge('F1', [[116, 75], [160, 75]])}
    ${edge('F2', [[210, 115], [210, 185]])}
    ${edge('F3', [[260, 225], [320, 225]])}
    ${edge('F4', [[345, 200], [345, 75], [600, 75]])}
    ${edge('F5', [[370, 225], [420, 225]])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Diag2" name="Finance only"><bpmndi:BPMNPlane id="Plane2" bpmnElement="Proc">
    ${shape('T2', 0, 0, 100, 80)}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`

export const D2 = 'direction: right\nstart -> review -> done\n'

/** What the d2 CLI returns: a root with only a viewBox, like d2 v0.9. */
export function d2Svg(portrait: boolean): string {
  const [w, h] = portrait ? [300, 900] : [900, 300]
  return `<svg xmlns="http://www.w3.org/2000/svg" data-d2-version="v0.9.0" preserveAspectRatio="xMinYMin meet" viewBox="0 0 ${w} ${h}">` +
    '<g class="shape"/><g class="shape"/><g class="shape"/>' +
    '<path class="connection stroke-B1"/><path class="connection fill-B1"/><path class="connection stroke-B1"/></svg>'
}

/** Width and height of an SVG's root element. */
export function sizeOf(svg: unknown): { w: number; h: number } {
  const m = /<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(String(svg))
  return { w: Number(m?.[1]), h: Number(m?.[2]) }
}
