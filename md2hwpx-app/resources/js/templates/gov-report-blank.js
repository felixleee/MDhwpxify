/* '빈 양식으로 시작' 용 범용 완료보고서 골격 템플릿.
   완료보고서(정부과제 등) 양식의 '구조'만 담고 도메인/내용은 모두 범용 플레이스홀더.
   - 제목/섹션명은 특정 사업(스마트공장 등)에 매이지 않게 '제목/소제목/항목 제목'으로 포괄화.
   - 표는 칸이 무슨 칸인지 알 수 있게 헤더만 두고 값은 비움.
   ⚠️ 실제 고객 데이터(회사명·과제번호·내용)는 절대 포함 금지. */
window.GOV_REPORT_BLANK = String.raw`[서식]


<table>
  <colgroup><col style="width:16.7%"><col style="width:33.3%"><col style="width:20.0%"><col style="width:30.0%"></colgroup>
  <tr>
    <th colspan="4">완료보고서</th>
  </tr>
  <tr>
    <td>사업명</td>
    <td></td>
    <td>수행기관</td>
    <td></td>
  </tr>
  <tr>
    <td>작성일자</td>
    <td></td>
    <td>작성자</td>
    <td></td>
  </tr>
</table>


**1. 제목**

 1.1 소제목

  □ **항목 제목**

<table>
  <colgroup><col style="width:70.0%"><col style="width:15.0%"><col style="width:15.0%"></colgroup>
  <tr>
    <th>구분</th>
    <th>내용</th>
    <th>비고</th>
  </tr>
  <tr>
    <td>(항목)</td>
    <td>(내용을 입력하세요)</td>
    <td></td>
  </tr>
</table>

 1.2 소제목

  □ **항목 제목**

     - (세부 내용을 입력하세요)

     - (세부 내용을 입력하세요)


**2. 제목**

 2.1 소제목

  □ **항목 제목**

<table>
  <colgroup><col style="width:6%"><col style="width:30%"><col style="width:12%"><col style="width:16%"><col style="width:16%"><col style="width:20%"></colgroup>
  <tr>
    <th>No</th>
    <th>항목</th>
    <th>단위</th>
    <th>현재</th>
    <th>목표</th>
    <th>비고</th>
  </tr>
  <tr>
    <td>1</td>
    <td>(항목명)</td>
    <td></td>
    <td></td>
    <td></td>
    <td></td>
  </tr>
</table>

 2.2 소제목

  □ **항목 제목**

     - (세부 내용을 입력하세요)


**3. 제목**

 3.1 소제목

  □ **항목 제목**

<table>
  <colgroup><col style="width:50.0%"><col style="width:50.0%"></colgroup>
  <tr>
    <th>구분</th>
    <th>내용</th>
  </tr>
  <tr>
    <td>(구분)</td>
    <td>(내용을 입력하세요)</td>
  </tr>
</table>


**4. 제목**

 4.1 소제목

  □ **(내용을 입력하세요)**
`;
