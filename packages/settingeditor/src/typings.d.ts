declare module 'react-jsonschema-form/lib/components/AddButton' {
  export interface IAddButtonProps {
    className: string;
    onClick: (event: any) => void;
    disabled: boolean;
  }
  export default function AddButton(props: IAddButtonProps): JSX.Element;
}
